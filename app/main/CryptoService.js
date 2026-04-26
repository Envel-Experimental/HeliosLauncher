const { ipcMain } = require('electron')
const crypto = require('crypto')

class CryptoService {
    init() {
        ipcMain.on('crypto:hashSync', (event, algorithm, data) => {
            try {
                const hash = crypto.createHash(algorithm).update(data).digest('hex')
                event.returnValue = hash
            } catch (e) {
                console.error(`[CryptoService] Sync hash failed for ${algorithm}:`, e)
                event.returnValue = null
            }
        })

        ipcMain.handle('crypto:hash', async (event, algorithm, data) => {
            try {
                if (!algorithm || !data) {
                    console.error(`[CryptoService] Invalid hash request: algo=${algorithm}, data=${data ? 'present' : 'missing'}`)
                    return null
                }
                console.debug(`[CryptoService] Async hash requested for ${algorithm}`)
                return crypto.createHash(algorithm).update(data).digest('hex')
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
