const { LoggerUtil } = require('../util/LoggerUtil')

const log = LoggerUtil.getLogger('MirrorManager')

class MirrorManager {
    constructor() {
        this.mirrors = []
        this.initialized = false
    }

    /**
     * Initialize the Mirror Manager with a list of mirror configurations.
     * @param {Array<Object>} mirrorConfigs List of mirror objects from config.js
     */
    async init(mirrorConfigs) {
        if (this.initialized) return
        if (!mirrorConfigs || !Array.isArray(mirrorConfigs) || mirrorConfigs.length === 0) {
            log.warn('No mirrors configured.')
            this.initialized = true
            return
        }

        this.mirrors = mirrorConfigs.map(m => ({
            config: m,
            latency: 9999,
            failures: 0,
            successes: 0,
            lastChecked: 0,
            status: 'unknown' // 'active', 'slow', 'down'
        }))

        log.info(`Initializing MirrorManager with ${this.mirrors.length} mirrors.`)

        // Initial Ping
        await this.measureAllLatencies()
        this.initialized = true
    }

    /**
     * Measure latency for all mirrors in parallel.
     */
    async measureAllLatencies() {
        const promises = this.mirrors.map(m => this._measureLatency(m))
        await Promise.allSettled(promises)
        this._sortMirrors()
        this._logStatus()
    }

    /**
     * Internal: Measure latency for a single mirror.
     * Tries to HEAD the version_manifest endpoint as a health check.
     */
    async _measureLatency(mirrorEntry) {
        const url = mirrorEntry.config.version_manifest || mirrorEntry.config.assets
        if (!url) {
            mirrorEntry.latency = 9999
            mirrorEntry.status = 'invalid'
            return
        }

        const start = Date.now()
        try {
            const controller = new AbortController()
            const id = setTimeout(() => controller.abort(), 5000) // 5s timeout

            const response = await fetch(url, {
                method: 'HEAD',
                signal: controller.signal
            })
            clearTimeout(id)

            if (response.ok) {
                const latency = Date.now() - start
                mirrorEntry.latency = latency
                mirrorEntry.status = latency < 300 ? 'active' : 'slow'
                mirrorEntry.lastChecked = Date.now()
                // Reset consecutive failures on success
                mirrorEntry.failures = 0
            } else {
                mirrorEntry.latency = 9999
                mirrorEntry.status = 'down'
                mirrorEntry.failures++
            }
        } catch (err) {
            mirrorEntry.latency = 9999
            mirrorEntry.status = 'down'
            mirrorEntry.failures++
        }
    }

    /**
     * Sort mirrors by:
     * 1. Status (active > slow > down)
     * 2. Latency (Low > High)
     * 3. Reliability (Failures Low > High)
     */
    _sortMirrors() {
        this.mirrors.sort((a, b) => {
            // Prioritize active mirrors
            if (a.status !== b.status) {
                const statusScore = { 'active': 0, 'slow': 1, 'down': 2, 'invalid': 3, 'unknown': 2 }
                return statusScore[a.status] - statusScore[b.status]
            }

            // If status same, check failures (reliability)
            if (a.failures !== b.failures) {
                return a.failures - b.failures
            }

            // Finally, latency
            return a.latency - b.latency
        })
    }

    _logStatus() {
        const status = this.mirrors.map(m => `${m.config.name}: ${m.latency}ms (${m.status})`)
        log.info(`Mirror Rankings: ${status.join(', ')}`)
    }

    /**
     * Get the best available mirrors, ranked.
     * @returns {Array<Object>} Array of mirror config objects
     */
    getSortedMirrors() {
        // Filter out completely dead mirrors if we have alternatives,
        // but always return at least one if possible (even if slow)
        // actually, just return the sorted list of configs
        return this.mirrors.map(m => m.config)
    }

    /**
     * Report a successful download from a mirror.
     * @param {string} mirrorUrl The base URL or full URL used.
     * @param {number} durationMs Time taken for download.
     * @param {number} bytes Download size.
     */
    reportSuccess(mirrorUrl, durationMs, bytes) {
        const entry = this._findMirrorByUrl(mirrorUrl)
        if (entry) {
            entry.successes++
            entry.failures = 0 // Reset failures on success

            // Update latency estimate (Exponential Moving Average)
            // If it was a small file, it's a good latency proxy.
            if (bytes < 1024 * 1024) { // < 1MB
                // Only update if duration is reasonable (not a huge blocking 10s wait)
                if (durationMs < 10000) {
                    entry.latency = Math.round((entry.latency * 0.7) + (durationMs * 0.3))
                }
            }

            if (entry.status !== 'active') {
                entry.status = 'active'
                this._sortMirrors() // Re-rank if status improved
            }
        }
    }

    /**
     * Report a failed download from a mirror.
     * @param {string} mirrorUrl The base URL or full URL used.
     */
    reportFailure(mirrorUrl) {
        const entry = this._findMirrorByUrl(mirrorUrl)
        if (entry) {
            entry.failures++
            if (entry.failures >= 3) {
                if (entry.status !== 'down') {
                    log.warn(`Mirror ${entry.config.name} marked as DOWN due to consecutive failures.`)
                    entry.status = 'down'
                    entry.latency = 9999
                    this._sortMirrors() // Re-rank immediately
                }
            }
        }
    }

    _findMirrorByUrl(url) {
        // Heuristic: Check if the provided URL starts with any mirror's base URL properties
        return this.mirrors.find(m => {
            const c = m.config
            return (c.assets && url.startsWith(c.assets)) ||
                (c.libraries && url.startsWith(c.libraries)) ||
                (c.client && url.startsWith(c.client)) ||
                (c.version_manifest && url.startsWith(c.version_manifest))
        })
    }
}

module.exports = new MirrorManager()
