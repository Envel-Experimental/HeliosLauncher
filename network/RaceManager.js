const { Readable } = require('stream')
const P2PEngine = require('./P2PEngine')
const HashVerifierStream = require('./HashVerifierStream')

class RaceManager {

    /**
     * Intercepts and handles the request using a Racing strategy.
     * @param {Request} request
     */
    async handle(request) {
        let url = request.url

        // Convert mc-asset protocol back to https for the HTTP fetch leg
        if (url.startsWith('mc-asset://')) {
            url = 'https://' + url.substring('mc-asset://'.length)
        }

        // Attempt to extract SHA1 hash from URL
        // Minecraft assets usually end with the hash or have it in the path
        // Pattern: .../objects/ab/abc123...
        // or just filename being the hash
        let hash = null
        const match = url.match(/([a-f0-9]{40})/i)
        if (match) {
            hash = match[1]
        }

        // If no hash found, fallback to direct HTTP
        if (!hash) {
            return fetch(url)
        }

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
            p2pStream = P2PEngine.requestFile(hash)

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
            } else {
                // HTTP Won
                if (p2pStream) p2pStream.destroy() // Cancel P2P

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
            const verifier = new HashVerifierStream('sha1', hash)
            sourceStream.pipe(verifier)

            // Return Response
            // Electron expects a Response object.
            // We convert the Node stream back to a Web Stream
            return new Response(Readable.toWeb(verifier))

        } catch (err) {
            // console.error(`[RaceManager] Failed to fetch ${hash}:`, err)
            // Fallback: If race fails (both failed), try original fetch again without signal?
            // Or just return 404
            return new Response('Not Found', { status: 404 })
        }
    }
}

module.exports = new RaceManager()
