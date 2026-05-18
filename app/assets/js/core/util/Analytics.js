const { ipcRenderer, ipcMain } = require('electron')
const ConfigManager = require('../configmanager')
const HWID = require('./HWID')

const FORTENLOG_KEY = 'fl_fc465ee421684c3f90cf4e04bb280d4f'
const FORTENLOG_HOST = 'http://localhost:3000'
const PROJECT_ID = 'flauncher-test'

const isRenderer = process.type === 'renderer'

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
            const sysInfo = ipcRenderer.sendSync('system:getSystemInfoSync')
            const javaConfig = ConfigManager.getJavaConfig()
            const currentVersion = ipcRenderer.sendSync('app:getVersionSync')
            const lastVersion = ConfigManager.getLastLauncherVersion()

            // Track Launcher Updated or First Launch
            if (!lastVersion) {
                this.capture('Launcher First Launch', { version: currentVersion })
                ConfigManager.setLastLauncherVersion(currentVersion)
                await ConfigManager.save()
            } else if (lastVersion !== currentVersion) {
                this.capture('Launcher Updated', {
                    from_version: lastVersion,
                    to_version: currentVersion
                })
                ConfigManager.setLastLauncherVersion(currentVersion)
                await ConfigManager.save()
            }

            this.capture('Launcher Loaded', {
                // These properties will be set on the person in PostHog
                $set: {
                    os_platform: sysInfo.platform,
                    os_arch: sysInfo.arch,
                    launcher_version: currentVersion,
                    cpu_model: sysInfo.cpus[0]?.model || 'Unknown',
                    cpu_count: sysInfo.cpus.length,
                    ram_total: Math.round(sysInfo.totalmem / 1024 / 1024 / 1024) + 'GB',
                    screen_res: `${window.screen.width}x${window.screen.height}`,
                    hwid: hwid
                },
                // OS & Launcher
                os_platform: sysInfo.platform,
                os_arch: sysInfo.arch,
                launcher_version: currentVersion,

                // CPU & RAM
                cpu_model: sysInfo.cpus[0]?.model || 'Unknown',
                cpu_count: sysInfo.cpus.length,
                ram_total: Math.round(sysInfo.totalmem / 1024 / 1024 / 1024) + 'GB',
                ram_free_at_start: Math.round(sysInfo.freemem / 1024 / 1024 / 1024) + 'GB',

                // Display
                screen_res: `${window.screen.width}x${window.screen.height}`,
                screen_ratio: window.devicePixelRatio,

                // Launcher Settings
                java_min_ram: javaConfig.minRAM,
                java_max_ram: javaConfig.maxRAM,
                p2p_enabled: ConfigManager.getP2PUploadEnabled(),
                p2p_limit: ConfigManager.getP2PUploadLimit()
            })

            // Test event to immediately verify FortenLog schemaless telemetry ingestion
            this.capture('desktop_preference_saved', {
                audio_device_out: 'SteelSeries Arctis 7',
                microphone_gain_multiplier: 1.5,
                custom_ui_scaling: '125%',
                stealth_mode_enabled: true,
                last_clicked_button: 'apply_voice_settings_btn'
            })

            // Start heartbeat every 5 minutes
            setInterval(async () => {
                let p2pStats = {}
                try {
                    const info = await ipcRenderer.invoke('p2p:getInfo')
                    const stats = await ipcRenderer.invoke('p2p:getStats')
                    p2pStats = {
                        p2p_active_connections: info.connections,
                        p2p_total_uploaded: stats.all?.uploaded || 0,
                        p2p_total_downloaded: stats.all?.downloaded || 0
                    }
                } catch (e) {
                    // P2P might not be initialized
                }

                this.capture('Heartbeat', {
                    session_duration_minutes: 5,
                    ...p2pStats
                })
            }, 5 * 60 * 1000)
        }
    }

    /**
     * Send an event to FortenLog
     * @param {string} event Name of the event
     * @param {Object} properties Additional properties
     */
    async capture(event, properties = {}) {
        if (!this.enabled || !this.distinctId) return

        const payload = {
            api_key: FORTENLOG_KEY,
            event: event,
            properties: {
                ...properties,
                distinct_id: this.distinctId,
                project: PROJECT_ID,
                $lib: 'FlauncherAnalytics',
                $lib_version: '1.2.0',
                $os: process.platform,
                $browser: isRenderer ? 'Electron-Renderer' : 'Electron-Main',
                release: this.release
            },
            timestamp: new Date().toISOString()
        }

        try {
            // fetch is available in Node 18+ and in Browser
            const response = await fetch(`${FORTENLOG_HOST}/capture/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-FortenLog-Request': 'true' // Magical CSRF bypass header for FortenLog
                },
                body: JSON.stringify(payload)
            })

            if (!response.ok && (isRenderer ? window.isDev : !require('electron').app.isPackaged)) {
                console.warn('[Analytics] FortenLog request failed:', response.status, response.statusText)
            }
        } catch (e) {
            if (isRenderer ? window.isDev : !require('electron').app.isPackaged) {
                console.error('[Analytics] Error sending to FortenLog:', e)
            }
        }
    }

    /**
     * Track an error using PostHog's standard $exception event for Error Tracking
     * @param {Error|string} error 
     */
    captureException(error) {
        // Disabled: all errors are handled exclusively by SentryService to prevent duplication in FortenLog
    }

    _parseStack(stack) {
        if (!stack) return []
        const lines = stack.split('\n').slice(1)
        const frames = []

        for (const line of lines) {
            try {
                const match = line.match(/at\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+))\)?/)
                if (match) {
                    frames.push({
                        platform: isRenderer ? 'web:javascript' : 'node:javascript',
                        function: match[1] || 'anonymous',
                        filename: match[2] || 'unknown',
                        lineno: parseInt(match[3], 10),
                        colno: parseInt(match[4], 10)
                    })
                }
            } catch (e) {
                // Ignore
            }
        }

        return frames.reverse()
    }
}

module.exports = new Analytics()

