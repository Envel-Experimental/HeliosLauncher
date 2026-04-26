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

const { DISTRO_PUB_KEYS } = require('../../network/config')
const { verifyDistribution } = require('../assets/js/core/util/SignatureUtils')
const ConfigManager = require('../assets/js/core/configmanager')

const CUSTOM_UPDATE_URL = 'https://f-launcher.ru/fox/new/updates'

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
                console.log('[AutoUpdater] Received checkForUpdate request (Floating Release Mode: ' + !!data + ')')
                try {
                    const autoUpdater = getAutoUpdater()
                    
                    // If we are in "Floating Release" mode, we allow pre-releases
                    // but we will add a filter in setupListeners or here.
                    autoUpdater.allowPrerelease = !!data

                    autoUpdater.checkForUpdates().then((result) => {
                        if (result && result.updateInfo) {
                            const title = (result.updateInfo.releaseName || result.updateInfo.version || '').toUpperCase()
                            const isPre = !!result.updateInfo.prerelease
                            
                            // If it's a pre-release, it MUST have "STABLE" in the title to be accepted as a "Floating Release"
                            if (isPre && !title.includes('STABLE')) {
                                console.log(`[AutoUpdater] Skipping pre-release ${result.updateInfo.version} because it lacks "STABLE" in title.`)
                                if (event.sender && !event.sender.isDestroyed()) {
                                    event.sender.send('autoUpdateNotification', 'update-not-available')
                                }
                                return
                            }
                        }
                        console.log('[AutoUpdater] Update check completed (Primary).', result ? 'Update available: ' + !!result.updateInfo : 'No result')
                    }).catch(async (err) => {
                        console.warn('[AutoUpdater] Primary update check failed, attempting fallback to custom server...', err.message)
                        
                        try {
                            // Switch to Custom Server
                            autoUpdater.setFeedURL({
                                provider: 'generic',
                                url: CUSTOM_UPDATE_URL
                            })

                            // Verify signature of latest.yml
                            const isSigned = await this.verifyMetadataSignature(CUSTOM_UPDATE_URL)
                            if (isSigned) {
                                console.log('[AutoUpdater] Custom server manifest signature verified. Checking for updates...')
                                autoUpdater.checkForUpdates().then((res) => {
                                    console.log('[AutoUpdater] Fallback update check completed.', res ? 'Update available: ' + !!res.updateInfo : 'No result')
                                }).catch(fallbackErr => {
                                    console.error('[AutoUpdater] Fallback update check failed:', fallbackErr)
                                    this.sendError(event.sender, fallbackErr)
                                })
                            } else {
                                console.error('[AutoUpdater] Custom server manifest signature INVALID or missing. Aborting.')
                                this.sendError(event.sender, new Error('Update verification failed (Signature Invalid)'))
                            }
                        } catch (fallbackEx) {
                            console.error('[AutoUpdater] Error during fallback initialization:', fallbackEx)
                            this.sendError(event.sender, fallbackEx)
                        }
                    })
                } catch (err) {
                    console.error('[AutoUpdater] Synchronous error during checkForUpdates:', err)
                    this.sendError(event.sender, err)
                }
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

    async verifyMetadataSignature(url) {
        const yamlName = process.platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml'
        const yamlUrl = `${url}/${yamlName}`
        const sigUrl = `${yamlUrl}.sig`

        try {
            console.log(`[AutoUpdater] Verifying signature for ${yamlName}...`)
            const yamlRes = await ConfigManager.fetchWithTimeout(yamlUrl, { cache: 'no-store' }, 8000)
            if (!yamlRes.ok) throw new Error(`YAML fetch failed: ${yamlRes.status}`)
            
            const yamlBuffer = Buffer.from(await yamlRes.arrayBuffer())

            const sigRes = await ConfigManager.fetchWithTimeout(sigUrl, { cache: 'no-store' }, 5000)
            if (!sigRes.ok) throw new Error(`SIG fetch failed: ${sigRes.status}`)
            
            const signatureHex = (await sigRes.text()).trim()

            return verifyDistribution({
                dataHex: yamlBuffer.toString('hex'),
                signatureHex: signatureHex,
                trustedKeys: DISTRO_PUB_KEYS
            })
        } catch (e) {
            console.error('[AutoUpdater] Signature verification error:', e.message)
            return false
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
