const { Readable } = require('stream')
const HashVerifierStream = require('./HashVerifierStream')
const Config = require('./config')
const NodeAdapter = require('./NodeAdapter')
const ConfigManager = require('../app/assets/js/configmanager')
const TrafficState = require('./TrafficState')

class RaceManager {

    constructor() {
        this.p2pConsecutiveWins = 0
    }

    isBusy() {
        return TrafficState.isBusy()
    }

    /**
     * Intercepts and handles the request using a Racing strategy.
     * @param {Request} request
     */
    async handle(request) {
        let url = request.url

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
        try {
            const pathHeader = request.headers.get('X-File-Path');
            if (pathHeader) {
                relPath = pathHeader;
            }
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
            globalP2PStream = P2PEngine.requestFile(hash, expectedSize)

            // Timeout P2P strictly to avoid waiting too long if HTTP is also slow/failing
            const timeout = setTimeout(() => {
                cleanup()
                console.log('[RaceManager] Global P2P Task Timed Out (Soft)')
                reject(new Error('Global P2P Timeout'))
            }, 3000) // 3s Soft Timeout for First Byte

            const onReadable = () => {
                clearTimeout(timeout)
                cleanup()
                resolve({ type: 'global_p2p', result: globalP2PStream })
            }
            const onError = (err) => {
                clearTimeout(timeout)
                cleanup()
                reject(err)
            }
            const cleanup = () => { globalP2PStream.off('readable', onReadable); globalP2PStream.off('error', onError) }
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

                this.p2pConsecutiveWins++
                if (this.p2pConsecutiveWins >= 10) { NodeAdapter.boostWeight(); this.p2pConsecutiveWins = 0 }
                return this._createVerifiedStream(winner.result, algo, hash, expectedSize)
            } else {

                // HTTP Won
                if (globalP2PStream) globalP2PStream.destroy() // Cancel Global P2P

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
                console.warn(`[RaceManager] P2P Download failed for ${hash}. (P2P Only Mode Active)`)
            } else {
                console.warn(`[RaceManager] Primary transfer methods failed for ${hash}. Retrying...`)
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
