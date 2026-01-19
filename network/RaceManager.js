const { Readable } = require('stream')
const P2PEngine = require('./P2PEngine')
const HashVerifierStream = require('./HashVerifierStream')
const Config = require('./config')
const NodeAdapter = require('./NodeAdapter')

class RaceManager {

    constructor() {
        this.p2pConsecutiveWins = 0
        this.activeDownloads = 0
    }

    isBusy() {
        return this.activeDownloads > 0
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

        // Attempt to extract hash from URL (SHA1 or MD5)
        // Minecraft assets usually end with the hash or have it in the path
        // Pattern: .../objects/ab/abc123... or just filename being the hash
        let hash = null
        // Match 40 chars (SHA1) or 32 chars (MD5)
        const match = url.match(/([a-f0-9]{40}|[a-f0-9]{32})/i)
        if (match) {
            hash = match[1]
        }

        // If no hash found, fallback to direct HTTP
        if (!hash) {
            return fetch(url)
        }

        // Determine algorithm based on length
        const algo = hash.length === 32 ? 'md5' : 'sha1'

        const abortController = new AbortController()

        // 1. HTTP Task
        const httpTask = fetch(url, { signal: abortController.signal })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                return { type: 'http', result: res }
            })

        // 2. P2P Task
        let p2pStream = null
        const p2pTask = new Promise((resolve, reject) => {
            p2pStream = P2PEngine.requestFile(hash, expectedSize)

            // We consider P2P "ready" when it becomes readable
            const onReadable = () => {
                cleanup()
                resolve({ type: 'p2p', result: p2pStream })
            }
            const onError = (err) => {
                cleanup()
                reject(err)
            }
            const cleanup = () => {
                p2pStream.off('readable', onReadable)
                p2pStream.off('error', onError)
            }

            p2pStream.on('readable', onReadable)
            p2pStream.on('error', onError)
        })

        try {
            // Race!
            const winner = await Promise.any([httpTask, p2pTask])

            let sourceStream
            if (winner.type === 'p2p') {
                // P2P Won
                abortController.abort() // Cancel HTTP
                sourceStream = winner.result
                // console.log(`[RaceManager] P2P won for ${hash.substring(0,8)}`)

                this.p2pConsecutiveWins++
                if (this.p2pConsecutiveWins >= 10) {
                    NodeAdapter.boostWeight()
                    this.p2pConsecutiveWins = 0
                }
            } else {
                // HTTP Won
                if (p2pStream) p2pStream.destroy() // Cancel P2P

                // Reset P2P win streak
                this.p2pConsecutiveWins = 0

                // Convert Web Stream to Node Stream for piping
                if (winner.result.body) {
                    sourceStream = Readable.fromWeb(winner.result.body)
                } else {
                    // Empty body?
                    sourceStream = Readable.from([])
                }
                // console.log(`[RaceManager] HTTP won for ${hash.substring(0,8)}`)
            }

            // Verify Integrity
            const verifier = new HashVerifierStream(algo, hash)
            sourceStream.pipe(verifier)

            // Return Response
            // Electron expects a Response object.
            // We convert the Node stream back to a Web Stream
            // Increment Active Downloads
            this.activeDownloads++
            const outputStream = Readable.toWeb(verifier)

            // Track when stream ends to decrement
            // Since we return a Web ReadableStream, we can't easily listen to 'close' on it directly here?
            // Actually, verifier is a Node stream. We can pipe verifier to a PassThrough and listen on that?
            // Or just listen on verifier.

            const cleanupDownload = () => {
                this.activeDownloads--
                if (this.activeDownloads < 0) this.activeDownloads = 0
                // console.log(`[RaceManager] Download finished. Active: ${this.activeDownloads}`)
            }

            verifier.on('close', cleanupDownload)
            verifier.on('error', cleanupDownload)
            // 'end' might not fire if it's a writable only? HashVerifierStream is likely a Transform or Writeable
            // If it is a Writable (hash verifier usually is), 'finish' is the event.
            verifier.on('finish', cleanupDownload)

            return new Response(outputStream)

        } catch (err) {
            // console.error(`[RaceManager] Failed to fetch ${hash}:`, err)

            // Retry with Mirrors defined in Config
            if (Config.HTTP_MIRRORS && Config.HTTP_MIRRORS.length > 0) {
                // Try to reconstruct path from original URL
                // Common format: https://resources.download.minecraft.net/ab/abc123...
                // or https://libraries.minecraft.net/...
                let pathSuffix = ''
                try {
                    const u = new URL(url)
                    pathSuffix = u.pathname
                } catch (e) {
                    // Fallback using hash logic if URL parsing fails
                    pathSuffix = `/${hash.substring(0, 2)}/${hash}`
                }

                for (const mirrorBase of Config.HTTP_MIRRORS) {
                    try {
                        const mirrorUrl = mirrorBase.replace(/\/$/, '') + pathSuffix
                        // console.log(`[RaceManager] Retrying with mirror: ${mirrorUrl}`)

                        const res = await fetch(mirrorUrl)
                        if (res.ok) {
                            let stream = Readable.fromWeb(res.body)
                            const verifier = new HashVerifierStream(algo, hash)
                            stream.pipe(verifier)
                            return new Response(Readable.toWeb(verifier))
                        }
                    } catch (mirrorErr) {
                        // Continue to next mirror
                    }
                }
            }

            return new Response('Not Found', { status: 404 })
        }
    }
}

module.exports = new RaceManager()
