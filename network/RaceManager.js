const { Readable } = require('stream')
const HashVerifierStream = require('./HashVerifierStream')
const Config = require('./config')
const NodeAdapter = require('./NodeAdapter')
const ConfigManager = require('../app/assets/js/configmanager')
const TrafficState = require('./TrafficState')
const path = require('path')
const isDev = require('../app/assets/js/isdev')

class RaceManager {

    constructor() {
        this.p2pConsecutiveWins = 0
        this.failureBuffer = []
        this.failureFlushTimer = null
        this.failureHistory = new Set()
    }

    logFailure(hash, relPath, context) {
        // Deduplicate: If hash already in buffer or recently logged, ignore
        if (this.failureHistory.has(hash)) return
        if (this.failureBuffer.find(x => x.hash === hash)) return

        const name = relPath ? path.basename(relPath) : hash.substring(0, 8)
        this.failureBuffer.push({ hash, name, context })

        if (this.failureFlushTimer) clearTimeout(this.failureFlushTimer)

        this.failureFlushTimer = setTimeout(() => {
            if (this.failureBuffer.length === 0) return

            const count = this.failureBuffer.length

            // Add to history to avoid repeat logs for 30s
            for (const item of this.failureBuffer) {
                this.failureHistory.add(item.hash)
                setTimeout(() => this.failureHistory.delete(item.hash), 30000)
            }

            if (count === 1) {
                const item = this.failureBuffer[0]
                console.warn(`[RaceManager] P2P Download failed for ${item.name}. (${item.context})`)
            } else {
                console.warn(`[RaceManager] P2P Download failed for ${count} files. Last context: ${this.failureBuffer[count - 1].context}`)
                // Readable List
                const names = this.failureBuffer.map(i => i.name).join(', ')
                console.warn('[RaceManager] Failed Files:', names)
            }
            this.failureBuffer = []
            this.failureFlushTimer = null
        }, 2000)
    }

    isBusy() {
        return TrafficState.isBusy()
    }

    /**
     * Intercepts and handles the request using a Racing strategy.
     * @param {Request} request
     */
    async handle(request) {
        const url_orig = request.url
        if (isDev) console.debug(`[RaceManager] handle() called: ${url_orig.substring(0, 100)}`)
        let url = url_orig

        let expectedSize = 0
        try {
            const sizeHeader = request.headers.get('X-Expected-Size')
            if (sizeHeader) expectedSize = parseInt(sizeHeader, 10)
        } catch (e) { }

        // Convert mc-asset protocol back to https for the HTTP fetch leg
        if (url.startsWith('mc-asset://')) {
            url = 'https://' + url.substring('mc-asset://'.length)
        }

        // Retrieve X-File-Path header passed by DownloadEngine
        let relPath = null;
        let fileId = null;
        try {
            const pathHeader = request.headers.get('X-File-Path');
            if (pathHeader) relPath = pathHeader;

            const idHeader = request.headers.get('X-File-Id');
            if (idHeader) fileId = idHeader;
        } catch (e) { }

        // Attempt to extract hash from URL (SHA1 or MD5)
        let hash = null
        const match = url.match(/([a-f0-9]{40}|[a-f0-9]{32})/i)
        if (match) hash = match[1]

        // If no hash found, fallback to direct HTTP
        if (!hash) return fetch(url)

        const algo = hash.length === 32 ? 'md5' : 'sha1'
        const abortController = new AbortController()

        // Check for Skip P2P Header (Resilience)
        let skipP2P = false
        try {
            if (request.headers.get('X-Skip-P2P')) {
                skipP2P = true
                // console.log('[RaceManager] Skipping P2P for this request (Force HTTP)')
            }
        } catch (e) { }

        // 1. HTTP Task
        const httpTask = new Promise((resolve, reject) => {
            if (ConfigManager.getP2POnlyMode()) {
                reject(new Error('HTTP Blocked: P2P Only Mode is Enabled'))
                return
            }

            fetch(url, { signal: abortController.signal })
                .then(res => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`)
                    if (!res.body) throw new Error('HTTP No Body')
                    resolve({ type: 'http', result: res })
                })
                .catch(reject)
        })

        // 2. Global P2P Task (Hyperswarm)
        let globalP2PStream = null
        const globalP2PTask = new Promise((resolve, reject) => {
            if (skipP2P) {
                // Return a never-resolving promise or just reject immediately with a special code?
                // Rejecting is better so Promise.any doesn't wait for it if HTTP also fails?
                // Actually Promise.any waits for first fulfillment. If we reject, it ignores it unless all reject.
                reject(new Error('P2P Skipped'))
                return
            }

            const P2PEngine = require('./P2PEngine')

            // Ambition Control: If P2P is overloaded, don't even try, let HTTP handle it.
            const loadStatus = P2PEngine.getLoadStatus()
            if (loadStatus === 'overloaded') {
                reject(new Error('P2P Overloaded'))
                return
            }

            globalP2PStream = P2PEngine.requestFile(hash, expectedSize, relPath, fileId)

            // Timeout P2P strictly to avoid waiting too long if HTTP is also slow/failing
            const timeout = setTimeout(() => {
                cleanup()
                if (isDev && P2PEngine.peers.length > 0) {
                    console.log(`[RaceManager] Global P2P Task Timed Out (Soft) for ${hash.substring(0, 8)}`)
                }
                reject(new Error('Global P2P Timeout'))
            }, 45000) // 45s Soft Timeout for First Byte

            const onReadable = () => {
                clearTimeout(timeout)
                cleanup()
                resolve({ type: 'global_p2p', result: globalP2PStream })
            }
            const onError = (err) => {
                clearTimeout(timeout)
                cleanup()
                if (isDev && P2PEngine.peers.length > 0 && !err.message.includes('Not Found')) {
                    console.warn(`[RaceManager] P2P Leg Failed for ${hash.substring(0, 8)}: ${err.message}`)
                }
                reject(err)
            }
            const cleanup = () => {
                globalP2PStream.off('readable', onReadable);
                globalP2PStream.off('error', onError)
                // CRITICAL: Add no-op error listener to prevent crash if 
                // the stream fails later (after we stop caring)
                globalP2PStream.on('error', () => { })
            }
            globalP2PStream.on('readable', onReadable)
            globalP2PStream.on('error', onError)
        })

        // 3. Local P2P Task (Legacy UDP/HTTP - DISABLED in favor of HyperDHT Local)
        // Local P2P logic removed as P2PManager is deprecated.

        try {
            // Race: HTTP vs Global (now Universal) P2P
            const winner = await Promise.any([httpTask, globalP2PTask])

            if (winner.type === 'global_p2p') {
                abortController.abort() // Cancel HTTP
                if (isDev) console.debug(`[RaceManager] P2P WON for ${hash.substring(0, 8)} (${fileId || relPath || 'n/a'})`)
                this.p2pConsecutiveWins++
                if (this.p2pConsecutiveWins >= 10) { NodeAdapter.boostWeight(); this.p2pConsecutiveWins = 0 }
                return this._createVerifiedStream(winner.result, algo, hash, expectedSize)
            } else {
                // HTTP Won
                if (globalP2PStream) globalP2PStream.destroy() // Cancel Global P2P
                if (isDev) console.debug(`[RaceManager] HTTP WON for ${hash.substring(0, 8)} (${fileId || relPath || 'n/a'})`)
                this.p2pConsecutiveWins = 0
                // Standard HTTP: Return the native Response object directly.
                // This avoids double-stream conversion overhead and compatibility issues.
                // Validation is handled by DownloadEngine at the end.
                return winner.result
            }
        } catch (err) {
            // All failed? Should not happen if HTTP is valid.
            if (globalP2PStream) globalP2PStream.destroy()
            abortController.abort()
            if (ConfigManager.getP2POnlyMode()) {
                this.logFailure(hash, fileId || relPath, 'P2P Only Mode Active')
            } else {
                this.logFailure(hash, fileId || relPath, 'Retrying...')
            }

            // Retry with Mirrors defined in Config


            throw err
        }
    }



    /**
     * Helper to create a verified response stream.
     */
    _createVerifiedStream(sourceStream, algo, hash, expectedSize) {
        // Verify Integrity
        const verifier = new HashVerifierStream(algo, hash, expectedSize)
        sourceStream.pipe(verifier)

        // Return Response
        // Electron expects a Response object.
        // We convert the Node stream back to a Web Stream
        TrafficState.incrementDownloads()
        const outputStream = Readable.toWeb(verifier)

        const cleanupDownload = () => {
            TrafficState.decrementDownloads()

            if (!TrafficState.isBusy()) {
                const P2PEngine = require('./P2PEngine')
                const stats = P2PEngine.getNetworkInfo()
                const downMB = (stats.downloaded / 1024 / 1024).toFixed(2)
                const upMB = (stats.uploaded / 1024 / 1024).toFixed(2)

                if (stats.downloaded > 0 || stats.uploaded > 0) {
                    console.log(`[P2P Stats] Session Finished. Total Downloaded: ${downMB} MB, Total Uploaded: ${upMB} MB`)
                }
            }
        }

        verifier.on('close', cleanupDownload)
        verifier.on('error', cleanupDownload)
        verifier.on('finish', cleanupDownload)

        return new Response(outputStream)
    }
}

module.exports = new RaceManager()
