const { ipcRenderer } = require('electron')
const ConfigManager = require('../configmanager')

const POSTHOG_KEY = 'phc_CeNtDkFd4kWMrpf7YH4gfA7zTzZhGZMw37Da25tSmPD3'
const POSTHOG_HOST = 'https://eu.i.posthog.com'

class Analytics {
    constructor() {
        this.enabled = true
        this.distinctId = null
    }

    async init() {
        if (!this.enabled) return

        this.distinctId = ConfigManager.getClientToken()
        
        if (!this.distinctId) {
            // Generate a permanent token and save it to config
            this.distinctId = crypto.randomUUID ? crypto.randomUUID() : 'ph_' + Math.random().toString(36).substring(2, 15)
            ConfigManager.setClientToken(this.distinctId)
            await ConfigManager.save()
            console.log('[Analytics] Generated and persisted new clientToken:', this.distinctId)
        }

        const sysInfo = ipcRenderer.sendSync('system:getSystemInfoSync')
        const javaConfig = ConfigManager.getJavaConfig()
        
        this.capture('Launcher Loaded', {
            // OS & Launcher
            os_platform: sysInfo.platform,
            os_arch: sysInfo.arch,
            launcher_version: ipcRenderer.sendSync('app:getVersionSync'),
            
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

        // Start heartbeat every 5 minutes to track session duration and P2P stats
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
                // P2P might not be initialized or available
            }

            this.capture('Heartbeat', {
                session_duration_minutes: 5,
                ...p2pStats
            })
        }, 5 * 60 * 1000)
    }

    /**
     * Send an event to PostHog
     * @param {string} event Name of the event
     * @param {Object} properties Additional properties
     */
    async capture(event, properties = {}) {
        if (!this.enabled || !this.distinctId) return

        const payload = {
            api_key: POSTHOG_KEY,
            event: event,
            properties: {
                ...properties,
                distinct_id: this.distinctId,
                $lib: 'FlauncherAnalytics',
                $lib_version: '1.0.0',
                $ip: '0.0.0.0',
                $os: process.platform,
                $browser: 'Electron'
            },
            timestamp: new Date().toISOString()
        }

        try {
            fetch(`${POSTHOG_HOST}/batch/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    api_key: POSTHOG_KEY,
                    batch: [payload]
                })
            }).catch(() => {
                // Silently fail if analytics are blocked
            })
        } catch (e) {
            // Silently fail
        }
    }

    /**
     * Track an error
     * @param {Error|string} error 
     */
    captureException(error) {
        const message = error instanceof Error ? error.message : error
        const stack = error instanceof Error ? error.stack : null

        this.capture('Error Occurred', {
            message,
            stack,
            isFatal: true
        })
    }
}

module.exports = new Analytics()
