const { LoggerUtil } = require('../app/assets/js/core/util/LoggerUtil')
const isDev = require('../app/assets/js/core/isdev')

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
        mirrorEntry.lastChecked = start // Always update last checked
        try {
            let result;
            if (process.type === 'renderer') {
                const { ipcRenderer } = require('electron')
                result = await ipcRenderer.invoke('mirrors:fetchHealth', url)
            } else {
                const controller = new AbortController()
                const id = setTimeout(() => controller.abort(), 8000) // 8s timeout

                const response = await fetch(url, {
                    method: 'GET',
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 HeliosLauncher/1.0',
                        'Range': 'bytes=0-0'
                    }
                })
                clearTimeout(id)
                result = {
                    ok: response.ok || response.status === 206,
                    status: response.status,
                    latency: Date.now() - start
                }
            }

            if (result.ok) {
                mirrorEntry.latency = result.latency
                mirrorEntry.status = result.latency < 400 ? 'active' : 'slow'
                mirrorEntry.failures = 0
            } else {
                if (isDev) console.warn(`[MirrorManager] Health check failed for ${url}: ${result.status || result.error}`);
                mirrorEntry.latency = 9999
                mirrorEntry.status = 'down'
                mirrorEntry.failures++
            }
        } catch (err) {
            if (isDev && err.name !== 'AbortError') console.warn(`[MirrorManager] Health check error for ${url}:`, err.message);
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
        // Trigger background re-test for DOWN mirrors if 5 minutes passed
        const now = Date.now()
        this.mirrors.forEach(m => {
            if (m.status === 'down' && (now - m.lastChecked > 300000)) { // 5 mins
                this._measureLatency(m) // Async background check
            }
        })
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
     * Find a mirror entry by checking if the URL belongs to it.
     * @param {string} url The URL to check.
     * @returns {Object|null} The mirror entry or null.
     */
    _findMirrorByUrl(url) {
        if (!url) return null
        return this.mirrors.find(m => {
            const configs = [
                m.config.base_url,
                m.config.version_manifest,
                m.config.assets,
                m.config.libraries,
                m.config.client,
                m.config.java_manifest,
                m.config.distribution
            ].filter(Boolean)

            return configs.some(c => {
                const base = c.includes('?') ? c.split('?')[0] : c
                const dir = base.substring(0, base.lastIndexOf('/') + 1)
                return url.startsWith(dir) || url.startsWith(base)
            })
        })
    }

    /**
     * Report a failed download from a mirror.
     * @param {string} mirrorUrl The base URL or full URL used.
     * @param {number} [statusCode] HTTP status code if available.
     */
    reportFailure(mirrorUrl, statusCode = 0) {
        const entry = this._findMirrorByUrl(mirrorUrl)
        if (entry) {
            // If it's a 404, don't treat it as a critical failure for the mirror status.
            // Some mirrors are partial or out of sync.
            if (statusCode === 404) {
                // if (isDev) log.debug(`Mirror ${entry.config.name} missing asset (404). Not counting as failure.`)
                return
            }

            entry.failures++
            if (entry.failures >= 15) { // Increased to 15
                if (entry.status !== 'down') {
                    const now = Date.now()
                    // Throttle the warning log to once per minute per mirror
                    if (!entry.lastWarned || (now - entry.lastWarned > 60000)) {
                        log.warn(`Mirror ${entry.config.name} marked as DOWN due to consecutive critical failures. (Status: ${statusCode || 'Network Error'})`)
                        entry.lastWarned = now
                    }
                    entry.status = 'down'
                    entry.latency = 9999
                    this._sortMirrors() // Re-rank immediately
                }
            }
        }
    }

    /**
     * Get a sanitized status report for all mirrors.
     * Use this for UI display to avoid exposing full URLs/IPs if sensitive.
     * @returns {Array<Object>} Array of status objects { name, latency, status }
     */
    getMirrorStatus() {
        return this.mirrors.map((m, index) => ({
            name: m.config.name || `Mirror #${index + 1}`,
            latency: m.latency === 9999 ? -1 : m.latency,
            status: m.status
        }))
    }
}

module.exports = new MirrorManager()
