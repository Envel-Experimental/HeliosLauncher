const { pipeline } = require('stream/promises')
const fs = require('fs-extra')
const path = require('path')
const { Readable } = require('stream')

/**
 * Downloads a file from a URL to a local path using native fetch and streams.
 *
 * @param {Object} asset The asset object.
 * @param {string} asset.url The URL to download.
 * @param {string} asset.path The local destination path.
 * @param {Object} [asset.headers] Optional headers for the request.
 * @param {function({transferred: number}): void} [onProgress] Callback for progress updates.
 * @returns {Promise<void>}
 */
exports.downloadFile = async function(asset, onProgress) {
    const options = {}
    if (asset.headers) {
        options.headers = asset.headers
    }

    const response = await fetch(asset.url, options)

    if (!response.ok) {
        throw new Error(`Failed to download ${asset.url}: ${response.status} ${response.statusText}`)
    }

    // Ensure directory exists
    await fs.ensureDir(path.dirname(asset.path))

    const fileStream = fs.createWriteStream(asset.path)
    let transferred = 0

    let readable
    // Check if Readable.fromWeb is available and if response.body is a Web Stream (not a Node stream)
    // Node streams have .pipe method. Web streams don't.
    if (Readable.fromWeb && response.body && !response.body.pipe) {
        try {
            readable = Readable.fromWeb(response.body)
        } catch (err) {
            // Fallback if fromWeb fails (e.g. invalid type)
            readable = response.body
        }
    } else {
        readable = response.body
    }

    if (onProgress) {
        // Use an async generator to track progress
        async function* progressGenerator(stream) {
            for await (const chunk of stream) {
                transferred += chunk.length
                onProgress({ transferred })
                yield chunk
            }
        }

        await pipeline(
            progressGenerator(readable),
            fileStream
        )
    } else {
        await pipeline(readable, fileStream)
    }
}
