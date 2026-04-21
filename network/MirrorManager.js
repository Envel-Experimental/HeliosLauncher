const https = require('https')
const url = require('url')
const isDev = require('../app/assets/js/core/isdev')

function logMain(msg) {
    process.stdout.write(`>>> [MirrorManager] ${msg}\n`)
}

class MirrorManager {
    constructor() {
        this.mirrors = []
        this.initialized = false
    }

    async init(mirrorConfigs) {
        if (this.initialized) return
        if (!mirrorConfigs || !Array.isArray(mirrorConfigs) || mirrorConfigs.length === 0) {
            logMain('No mirrors configured.')
            this.initialized = true
            return
        }

        logMain(`Initializing with ${mirrorConfigs.length} mirrors.`)

        this.mirrors = mirrorConfigs.map(m => ({
            config: m,
            latency: 9999,
            failures: 0,
            successes: 0,
            lastChecked: 0,
            status: 'unknown'
        }))

        await this.measureAllLatencies()
        this.initialized = true
        logMain('Initialization complete.')
    }

    async measureAllLatencies() {
        logMain('Measuring all latencies...')
        const promises = this.mirrors.map(m => this._measureLatency(m))
        await Promise.allSettled(promises)
        this._sortMirrors()
        this._logStatus()
    }

    _measureLatency(mirrorEntry) {
        return new Promise((resolve) => {
            const rawUrl = mirrorEntry.config.version_manifest || 
                           mirrorEntry.config.assets || 
                           mirrorEntry.config.java_manifest || 
                           mirrorEntry.config.distribution
            
            if (!rawUrl) {
                mirrorEntry.latency = 9999
                mirrorEntry.status = 'invalid'
                return resolve()
            }

            const start = Date.now()
            const testUrl = rawUrl + (rawUrl.includes('?') ? '&' : '?') + 't=' + start
            
            const options = {
                ...url.parse(testUrl),
                method: 'GET',
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 HeliosLauncher/1.0'
                }
            }

            const req = https.request(options, (res) => {
                const latency = Date.now() - start
                mirrorEntry.lastChecked = Date.now()
                
                if (res.statusCode >= 200 && res.statusCode < 400) {
                    mirrorEntry.latency = latency
                    mirrorEntry.status = latency < 400 ? 'active' : 'slow'
                    mirrorEntry.failures = 0
                    logMain(`SUCCESS: ${mirrorEntry.config.name} (${latency}ms)`)
                } else {
                    logMain(`FAILED: ${mirrorEntry.config.name} (Status: ${res.statusCode})`)
                    mirrorEntry.latency = 9999
                    mirrorEntry.status = 'down'
                    mirrorEntry.failures++
                }
                res.on('data', () => {}) // Consume data
                res.on('end', () => resolve())
            })

            req.on('error', (err) => {
                logMain(`ERROR: ${mirrorEntry.config.name} (${err.message})`)
                mirrorEntry.latency = 9999
                mirrorEntry.status = 'down'
                mirrorEntry.failures++
                resolve()
            })

            req.on('timeout', () => {
                logMain(`TIMEOUT: ${mirrorEntry.config.name}`)
                req.destroy()
                mirrorEntry.latency = 9999
                mirrorEntry.status = 'down'
                mirrorEntry.failures++
                resolve()
            })

            req.end()
        })
    }

    _sortMirrors() {
        this.mirrors.sort((a, b) => {
            if (a.status !== b.status) {
                const statusScore = { 'active': 0, 'slow': 1, 'down': 2, 'invalid': 3, 'unknown': 2 }
                return statusScore[a.status] - statusScore[b.status]
            }
            return a.latency - b.latency
        })
    }

    _logStatus() {
        const status = this.mirrors.map(m => `${m.config.name}: ${m.latency}ms (${m.status})`)
        logMain(`Rankings: ${status.join(', ')}`)
    }

    getSortedMirrors() {
        return this.mirrors.map(m => m.config)
    }

    reportSuccess(mirrorUrl, durationMs, bytes) {
        const entry = this._findMirrorByUrl(mirrorUrl)
        if (entry) {
            entry.successes++
            entry.failures = 0
            if (entry.status !== 'active') {
                entry.status = 'active'
                this._sortMirrors()
            }
        }
    }

    _findMirrorByUrl(urlStr) {
        if (!urlStr) return null
        return this.mirrors.find(m => {
            const configs = [
                m.config.version_manifest,
                m.config.assets,
                m.config.libraries,
                m.config.client,
                m.config.java_manifest,
                m.config.distribution
            ].filter(Boolean)

            return configs.some(c => urlStr.startsWith(c))
        })
    }

    reportFailure(mirrorUrl, statusCode = 0) {
        const entry = this._findMirrorByUrl(mirrorUrl)
        if (entry) {
            if (statusCode === 404) return
            entry.failures++
            if (entry.failures >= 15) {
                entry.status = 'down'
                entry.latency = 9999
                this._sortMirrors()
            }
        }
    }

    getMirrorStatus() {
        return this.mirrors.map((m, index) => ({
            name: m.config.name || `Mirror #${index + 1}`,
            latency: m.latency === 9999 ? -1 : m.latency,
            status: m.status
        }))
    }
}

module.exports = new MirrorManager()
