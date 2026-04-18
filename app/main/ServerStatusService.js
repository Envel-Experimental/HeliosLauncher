const { ipcMain } = require('electron')
const { getServerStatus } = require('../assets/js/core/mojang/ServerStatusAPI')

class ServerStatusService {
    init() {
        ipcMain.handle('server:status', async (event, protocol, hostname, port) => {
            return await getServerStatus(protocol, hostname, port)
        })
    }
}

module.exports = new ServerStatusService()
