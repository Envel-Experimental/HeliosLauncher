const { ipcRenderer, ipcMain } = require('electron')
const ConfigManager = require('../configmanager')
const HWID = require('./HWID')

const isRenderer = process.type === 'renderer'

const { SafeSentry } = require('./SentryWrapper')
const SentryMain = !isRenderer ? require('../../../../main/SentryService') : null

class Analytics {
    constructor() {
        this.enabled = true
        this.distinctId = null
        this.release = undefined
    }

    async init() {
        if (!this.enabled) return

        try {
            const versionData = require('../../version.json')
            this.release = versionData.release
        } catch (e) {
            this.release = undefined
        }

        // Identification Logic
        let hwid = HWID.getHWID()
        const storedToken = ConfigManager.getClientToken()

        if (hwid.startsWith('fallback_') && storedToken) {
            // If HWID failed but we have a stored token, prefer the stored one for continuity
            this.distinctId = storedToken
        } else {
            this.distinctId = hwid
            // Update stored token if it's missing or if we have a fresh stable HWID
            if (!storedToken || (!hwid.startsWith('fallback_') && storedToken !== hwid)) {
                ConfigManager.setClientToken(hwid)
                await ConfigManager.save()
            }
        }

        if (isRenderer) {
            const currentVersion = ipcRenderer.sendSync('app:getVersionSync')
            const lastVersion = ConfigManager.getLastLauncherVersion()

            // Update last version if it's missing or changed
            if (!lastVersion || lastVersion !== currentVersion) {
                ConfigManager.setLastLauncherVersion(currentVersion)
                await ConfigManager.save()
            }
        }
    }

    /**
     * Send an event to Sentry (Bugsink)
     * @param {string} event Name of the event
     * @param {Object} properties Additional properties
     */
    async capture(event, properties = {}) {
        // Event tracking disabled as requested (PostHog removed)
        if (window.isDev) {
            console.log(`[Analytics] Event: ${event}`, properties)
        }
    }

    /**
     * Track an error using Sentry (Bugsink)
     * @param {Error|string} error 
     */
    captureException(error) {
        if (!error) return

        if (isRenderer) {
            SafeSentry.captureException(error)
        } else {
            SentryMain.captureException(error)
        }
    }
}

module.exports = new Analytics()

