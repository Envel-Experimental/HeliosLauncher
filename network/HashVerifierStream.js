const { Transform } = require('stream')
const crypto = require('crypto')

class HashVerifierStream extends Transform {
    /**
     * @param {string} algorithm - 'sha1', 'sha256', etc.
     * @param {string} expectedHash - The hex string of the expected hash.
     */
    constructor(algorithm, expectedHash) {
        super()
        this.algorithm = algorithm
        this.expectedHash = expectedHash.toLowerCase()
        this.hasher = crypto.createHash(algorithm)
    }

    _transform(chunk, encoding, callback) {
        this.hasher.update(chunk)
        this.push(chunk)
        callback()
    }

    _flush(callback) {
        const calculatedHash = this.hasher.digest('hex')
        if (calculatedHash !== this.expectedHash) {
            console.error(`[P2P Debug] Hash mismatch! Expected: ${this.expectedHash}, Actual: ${calculatedHash}`)
            const err = new Error(`Hash mismatch`)
            err.code = 'HASH_MISMATCH'
            err.expected = this.expectedHash
            err.actual = calculatedHash
            callback(err)
        } else {
            callback()
        }
    }
}

module.exports = HashVerifierStream
