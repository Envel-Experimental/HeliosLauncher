const { ipcMain } = require('electron')
const crypto = require('crypto')

/** Allowed hash algorithms — prevents use of deprecated/weak algos */
const ALLOWED_HASH_ALGORITHMS = new Set(['sha1', 'sha256', 'sha512', 'sha384', 'md5'])

/**
 * Validates that the requested algorithm is in the allowlist.
 * @param {string} algorithm
 * @returns {boolean}
 */
function isAllowedAlgorithm(algorithm) {
    return typeof algorithm === 'string' && ALLOWED_HASH_ALGORITHMS.has(algorithm.toLowerCase())
}

class CryptoService {
    init() {
        ipcMain.on('crypto:hashSync', (event, algorithm, data) => {
            if (!isAllowedAlgorithm(algorithm)) {
                console.warn(`[CryptoService] Rejected disallowed hash algorithm: ${algorithm}`)
                event.returnValue = null
                return
            }
            try {
                const hash = crypto.createHash(algorithm.toLowerCase()).update(data).digest('hex')
                event.returnValue = hash
            } catch (e) {
                console.error(`[CryptoService] Sync hash failed for ${algorithm}:`, e)
                event.returnValue = null
            }
        })

        ipcMain.handle('crypto:hash', async (event, algorithm, data) => {
            if (!isAllowedAlgorithm(algorithm)) {
                console.warn(`[CryptoService] Rejected disallowed hash algorithm: ${algorithm}`)
                return null
            }
            try {
                if (!data) {
                    console.error(`[CryptoService] Invalid hash request: data missing`)
                    return null
                }
                return crypto.createHash(algorithm.toLowerCase()).update(data).digest('hex')
            } catch (e) {
                console.error(`[CryptoService] Hash failed for ${algorithm}:`, e)
                return null
            }
        })

        ipcMain.handle('crypto:verify', async (event, algorithm, data, key, signature) => {
            try {
                // Handle different data formats (Hex strings or Buffers)
                const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'hex')
                const sigBuf = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, 'hex')

                return crypto.verify(algorithm, dataBuf, key, sigBuf)
            } catch (e) {
                console.error(`[CryptoService] Verify failed:`, e)
                return false
            }
        })

        ipcMain.on('crypto:verifySync', (event, algorithm, data, key, signature) => {
            try {
                const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'hex')
                const sigBuf = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, 'hex')
                event.returnValue = crypto.verify(algorithm, dataBuf, key, sigBuf)
            } catch (e) {
                console.error(`[CryptoService] VerifySync failed:`, e)
                event.returnValue = false
            }
        })

        ipcMain.handle('crypto:verifyDistribution', async (event, { dataHex, signatureHex, trustedKeys }) => {
            try {
                const contentBuffer = Buffer.from(dataHex, 'hex')
                const signature = Buffer.from(signatureHex, 'hex')
                const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

                for (const keyHex of trustedKeys) {
                    try {
                        const rawKey = Buffer.from(keyHex, 'hex')
                        const spkiKey = Buffer.concat([ED25519_SPKI_PREFIX, rawKey])
                        const publicKey = crypto.createPublicKey({
                            key: spkiKey,
                            format: 'der',
                            type: 'spki'
                        })

                        if (crypto.verify(null, contentBuffer, publicKey, signature)) {
                            return true
                        }
                    } catch (e) {
                        // Key failure, try next
                    }
                }
            } catch (err) {
                console.error('[CryptoService] verifyDistribution error:', err)
            }
            return false
        })
    }
}

module.exports = new CryptoService()
