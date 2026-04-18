const EventEmitter = require('events')

class AutoUpdater extends EventEmitter {
    constructor() {
        super()
        this.autoDownload = true
        this.autoInstallOnAppQuit = true
        this.allowPrerelease = false
    }

    async checkForUpdates() {
        console.log('[UpdaterMock] Checking for updates...')
        this.emit('checking-for-update')
        // Simulate no update available by default
        setTimeout(() => {
            this.emit('update-not-available', { version: '0.0.1' })
        }, 1000)
        return null
    }

    async checkForUpdatesAndNotify() {
        return this.checkForUpdates()
    }

    quitAndInstall() {
        console.log('[UpdaterMock] Quitting and installing...')
    }
}

module.exports = {
    autoUpdater: new AutoUpdater()
}
