// @ts-check
'use strict'

const { Transform } = require('stream')
const crypto = require('crypto')

/**
 * HashVerifierStream — Transform stream that computes and verifies a hash as
 * data flows through it.
 *
 * ## Event-loop safety
 *   `crypto.Hash.digest()` is synchronous and O(N) in block count for some
 *   algorithms. On large files (>5 MB) this can produce a measurable event-loop
 *   pause when _flush() is called because Node.js _flush handlers run
 *   synchronously inside the stream machinery.
 *
 *   We defer the comparison to the next iteration via setImmediate() so that
 *   the event loop can process any pending I/O callbacks (e.g. keep-alive
 *   pings, socket drains) before we block on digest(). The actual digest() call
 *   itself remains synchronous (no async alternative exists in the built-in
 *   crypto module without worker threads), but at least we yield first.
 *
 *   For files <5 MB the overhead is imperceptible; for 30+ MB files this
 *   avoids a visible UI freeze when multiple files finish simultaneously.
 */
class HashVerifierStream extends Transform {
    /**
     * @param {string} algorithm  - 'sha1', 'sha256', etc.
     * @param {string} expectedHash - Hex string of the expected hash.
     */
    constructor(algorithm, expectedHash) {
        super()
        this.algorithm = algorithm
        this.expectedHash = (expectedHash || '').toLowerCase()

        try {
            // Normalise: 'SHA-256' → 'sha256', 'sha1' → 'sha1'
            const algoStr = (algorithm || '').toLowerCase().replace('-', '')
            this.hasher = crypto.createHash(algoStr)
        } catch (e) {
            console.error(`[HashVerifierStream] Invalid hashing algorithm: ${algorithm}`)
            this.hasher = null
        }
    }

    _transform(chunk, encoding, callback) {
        if (!this.hasher) {
            this.push(chunk)
            return callback()
        }
        this.hasher.update(chunk)
        this.push(chunk)
        callback()
    }

    _flush(callback) {
        if (!this.hasher) {
            return callback(new Error(`Hash verification failed: Invalid algorithm ${this.algorithm}`))
        }

        // Yield the event loop BEFORE calling digest() so that concurrent I/O
        // (socket reads, ping timers) gets a chance to fire. digest() itself
        // is synchronous and cannot be avoided.
        setImmediate(() => {
            const calculatedHash = this.hasher.digest('hex')
            if (calculatedHash !== this.expectedHash) {
                if (process.env.NODE_ENV !== 'production') {
                    console.error(`[HashVerifierStream] Hash mismatch! Expected: ${this.expectedHash}, Actual: ${calculatedHash}`)
                }
                const err = Object.assign(new Error('Hash mismatch'), {
                    code: 'HASH_MISMATCH',
                    expected: this.expectedHash,
                    actual: calculatedHash
                })
                callback(err)
            } else {
                callback()
            }
        })
    }
}

module.exports = HashVerifierStream
