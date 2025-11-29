const fs = require('fs-extra')
const path = require('path')
const ConfigManager = require('./configmanager')
const { LoggerUtil } = require('@envel/helios-core')

const logger = LoggerUtil.getLogger('MirrorManager')

// Default mirrors (Hardcoded)
// Ensure these end with a slash if they are directories.
const DEFAULT_MIRRORS = [
    'https://f-launcher.ru/fox/new/'
]

const DISTRO_FILENAME = 'distribution.json'
const UPDATE_FILENAME = 'update-distro.json'
const CONFIG_FILENAME = 'distro-config.json'

class MirrorManager {
    constructor() {
        this.mirrors = [...DEFAULT_MIRRORS]
        this.currentMirror = null
    }

    /**
     * Initialize the MirrorManager.
     * Loads saved configuration and merges with defaults.
     */
    async init() {
        const savedMirrors = await this.loadSavedMirrors()
        if (savedMirrors && Array.isArray(savedMirrors) && savedMirrors.length > 0) {
            // Merge defaults and saved mirrors.
            // We use a Set to ensure uniqueness.
            // Saved mirrors are added to the list.
            const uniqueMirrors = new Set([...DEFAULT_MIRRORS, ...savedMirrors])
            this.mirrors = Array.from(uniqueMirrors)
        }
        logger.info('Initialized with mirrors:', this.mirrors)
    }

    /**
     * Load mirrors from the local configuration file.
     * @returns {Promise<Array<string>|null>}
     */
    async loadSavedMirrors() {
        const configPath = path.join(ConfigManager.getLauncherDirectory(), CONFIG_FILENAME)
        try {
            if (await fs.pathExists(configPath)) {
                const content = await fs.readJson(configPath)
                if (this.validateConfig(content)) {
                    return content.mirrors
                } else {
                    logger.warn('Loaded config failed validation.')
                }
            }
        } catch (error) {
            logger.warn('Failed to load saved mirror config:', error)
        }
        return null
    }

    /**
     * Validate the update-distro.json structure.
     * @param {Object} config
     * @returns {boolean}
     */
    validateConfig(config) {
        if (!config || typeof config !== 'object') return false
        if (!Array.isArray(config.mirrors)) return false

        // STRICT validation: Check if every item is a valid URL string
        const isValid = config.mirrors.every(url => {
            if (typeof url !== 'string') return false
            try {
                const u = new URL(url)
                return u.protocol === 'http:' || u.protocol === 'https:'
            } catch (e) {
                return false
            }
        })

        return isValid
    }

    /**
     * Select the best mirror by racing HEAD requests.
     * @returns {Promise<string>} The selected mirror base URL.
     */
    async selectBestMirror() {
        logger.info('Selecting best mirror from:', this.mirrors)

        if (this.mirrors.length === 0) {
            logger.error('No mirrors defined.')
            return null
        }

        if (this.mirrors.length === 1) {
            this.currentMirror = this.mirrors[0]
            return this.currentMirror
        }

        // Lightweight race
        const promises = this.mirrors.map(mirror => this.ping(mirror))

        try {
            const winner = await Promise.any(promises)
            this.currentMirror = winner
            logger.info('Selected mirror (fastest):', winner)
            return winner
        } catch (error) {
            logger.error('All mirrors failed connectivity check. Defaulting to first.', error)
            this.currentMirror = this.mirrors[0]
            return this.currentMirror
        }
    }

    /**
     * Ping a mirror using a HEAD request to the distribution file.
     * @param {string} baseUrl
     * @returns {Promise<string>}
     */
    async ping(baseUrl) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5000) // 5s timeout

        try {
            const url = new URL(DISTRO_FILENAME, baseUrl).href
            const response = await fetch(url, {
                method: 'HEAD',
                signal: controller.signal
            })
            clearTimeout(timeoutId)
            if (response.ok) {
                return baseUrl
            } else {
                throw new Error(`Ping failed with status ${response.status}`)
            }
        } catch (error) {
            clearTimeout(timeoutId)
            throw error
        }
    }

    /**
     * Get the full URL for the distribution index on the current mirror.
     * @returns {string|null}
     */
    getDistributionURL() {
        if (!this.currentMirror) return null
        return new URL(DISTRO_FILENAME, this.currentMirror).href
    }

    /**
     * Switch to the next available mirror.
     * @returns {string} The new current mirror.
     */
    getNextMirror() {
        if (!this.currentMirror) {
            this.currentMirror = this.mirrors[0]
            return this.currentMirror
        }
        const index = this.mirrors.indexOf(this.currentMirror)
        // Move to next index, wrapping around
        const nextIndex = (index + 1) % this.mirrors.length
        this.currentMirror = this.mirrors[nextIndex]
        logger.info('Switched to next mirror:', this.currentMirror)
        return this.currentMirror
    }
}

class ConfigUpdater {
    /**
     * Check for update-distro.json on the current mirror.
     * @param {MirrorManager} mirrorManager
     */
    async checkForUpdate(mirrorManager) {
        const currentMirror = mirrorManager.currentMirror
        if (!currentMirror) return

        try {
            const url = new URL(UPDATE_FILENAME, currentMirror).href
            logger.info('Checking for remote config update at', url)

            const response = await fetch(url)
            if (response.ok) {
                const json = await response.json()
                if (mirrorManager.validateConfig(json)) {
                    logger.info('Found valid remote config. Checking for changes...')
                    await this.saveConfig(json)
                } else {
                    logger.warn('Invalid remote config schema.')
                }
            } else {
                logger.info('No update-distro.json found (status ' + response.status + ')')
            }
        } catch (error) {
            logger.warn('Failed to fetch remote config:', error)
        }
    }

    async saveConfig(config) {
         const configPath = path.join(ConfigManager.getLauncherDirectory(), CONFIG_FILENAME)
         try {
             // Check if file exists and matches
             if (await fs.pathExists(configPath)) {
                 const currentConfig = await fs.readJson(configPath)
                 if (JSON.stringify(currentConfig) === JSON.stringify(config)) {
                     logger.info('Remote config is identical to local config. Skipping save.')
                     return
                 }
             }

             await fs.writeJson(configPath, config)
             logger.info('Saved remote config.')
         } catch (error) {
             logger.error('Failed to save remote config:', error)
         }
    }
}

module.exports = {
    MirrorManager: new MirrorManager(),
    ConfigUpdater: new ConfigUpdater()
}
