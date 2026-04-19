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
                console.log(`[CryptoService] Async hash requested for ${algorithm}`)
                return crypto.createHash(algorithm).update(data).digest('hex')
            } catch (e) {
                console.error(`[CryptoService] Hash failed for ${algorithm}:`, e)
                return null
            }
        })
    }
}

module.exports = new CryptoService()
