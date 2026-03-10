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
        this.expectedHash = (expectedHash || '').toLowerCase()
        
        try {
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
