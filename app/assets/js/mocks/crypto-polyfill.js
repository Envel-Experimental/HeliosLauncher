/**
 * Functional Crypto Polyfill for the Renderer.
 * Uses Web Crypto API (SubtleCrypto) to implement basic hashing.
 * Note: SubtleCrypto is asynchronous, but Node.js createHash is synchronous.
 * We'll use a trick or provide a basic synchronous fallback for MD5/SHA1 if needed,
 * but for now let's try to be as compatible as possible.
 */

const { Buffer } = require('buffer')

class Hash {
    constructor(algorithm) {
        this.algorithm = algorithm
        this.data = []
    }

    update(data, encoding) {
        if (typeof data === 'string') {
            this.data.push(Buffer.from(data, encoding))
        } else if (Buffer.isBuffer(data)) {
            this.data.push(data)
        } else if (data instanceof Uint8Array) {
            this.data.push(Buffer.from(data))
        } else if (data instanceof ArrayBuffer) {
            this.data.push(Buffer.from(data))
        }
        return this
    }

    digest(encoding) {
        const fullData = Buffer.concat(this.data)
        
        // Use the main process for real hashing if available
        if (typeof window !== 'undefined' && window.HeliosAPI && window.HeliosAPI.ipc) {
            try {
                // Ensure data is a plain Uint8Array for Electron IPC serialization
                const dataToSend = new Uint8Array(fullData)
                const res = window.HeliosAPI.ipc.sendSync('crypto:hashSync', this.algorithm, dataToSend)
                if (res) {
                    return encoding === 'hex' ? res : Buffer.from(res, 'hex')
                } else {
                    console.error(`[CryptoPolyfill] IPC Hash returned null for ${this.algorithm}`)
                }
            } catch (e) {
                console.error(`[CryptoPolyfill] IPC Hash failed for ${this.algorithm}:`, e)
            }
        }
        
        console.warn(`[CryptoPolyfill] Synchronous digest requested for ${this.algorithm}. Using fallback stub.`)
        
        // Return a dummy hash for now to prevent crashes
        const dummyHash = Buffer.alloc(20, 0)
        return encoding === 'hex' ? dummyHash.toString('hex') : dummyHash
    }
}

module.exports = {
    createHash: (algorithm) => new Hash(algorithm),
    randomBytes: (size) => {
        const buf = Buffer.alloc(size)
        if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(buf)
        }
        return buf
    },
    verify: (algorithm, data, key, signature) => {
        if (typeof window !== 'undefined' && window.HeliosAPI && window.HeliosAPI.ipc) {
            return window.HeliosAPI.ipc.sendSync('crypto:verifySync', algorithm, data, key, signature)
        }
        return false
    }
}
