// const { autoUpdater } = require('electron-updater')
const { ipcMain, app } = require('electron')

/**
 * Lazy-load autoUpdater to prevent early initialization crashes.
 */
function getAutoUpdater() {
    return require('electron-updater').autoUpdater
}

const path = require('path')
const isDev = require('../assets/js/core/isdev')
const semver = require('semver')

class AutoUpdaterService {
    constructor() {
        this.event = null
    }

    init() {
        ipcMain.on('autoUpdateAction', (event, arg, data) => {
            if (event.sender.isDestroyed()) return
            this.handleAction(event, arg, data)
        })
    }

    handleAction(event, arg, data) {
        switch (arg) {
            case 'initAutoUpdater':
                this.setupListeners(event, data)
                if (event.sender && !event.sender.isDestroyed()) {
                    event.sender.send('autoUpdateNotification', 'ready')
                }
                break
            case 'checkForUpdate':
                getAutoUpdater().checkForUpdates().catch(err => {
                    this.sendError(event.sender, err)
                })
                break
            case 'allowPrereleaseChange':
                this.handlePrereleaseChange(data)
                break
            case 'installUpdateNow':
                getAutoUpdater().quitAndInstall(false, true)
                break
            default:
                console.log('Unknown autoUpdateAction:', arg)
        }
    }

    setupListeners(event, data) {
        if (data) {
            getAutoUpdater().allowPrerelease = true
        }

        if (isDev) {
            getAutoUpdater().autoInstallOnAppQuit = false
            getAutoUpdater().updateConfigPath = path.join(app.getAppPath(), 'dev-app-update.yml')
        }
        
        if (process.platform === 'darwin') {
            getAutoUpdater().autoDownload = false
        }

        const sender = event.sender

        getAutoUpdater().removeAllListeners()

        getAutoUpdater().on('update-available', info => {
            if (!sender.isDestroyed()) sender.send('autoUpdateNotification', 'update-available', info)
        })
        getAutoUpdater().on('update-downloaded', info => {
            if (!sender.isDestroyed()) sender.send('autoUpdateNotification', 'update-downloaded', info)
        })
        getAutoUpdater().on('update-not-available', info => {
            if (!sender.isDestroyed()) sender.send('autoUpdateNotification', 'update-not-available', info)
        })
        getAutoUpdater().on('checking-for-update', () => {
            if (!sender.isDestroyed()) sender.send('autoUpdateNotification', 'checking-for-update')
        })
        getAutoUpdater().on('error', err => {
            this.sendError(sender, err)
        })
    }

    handlePrereleaseChange(data) {
        if (!data) {
            const preRelComp = semver.prerelease(app.getVersion())
            getAutoUpdater().allowPrerelease = (preRelComp != null && preRelComp.length > 0)
        } else {
            getAutoUpdater().allowPrerelease = data
        }
    }

    sendError(sender, err) {
        if (sender.isDestroyed()) return
        if (err.code === 'EPERM' || err.code === 'ENOENT') {
            sender.send('autoUpdateNotification', 'antivirus-issue')
        } else {
            sender.send('autoUpdateNotification', 'realerror', err)
        }
    }
}

module.exports = new AutoUpdaterService()
