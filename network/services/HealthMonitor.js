// @ts-check
'use strict'

const os = require('os')
const isDev = require('../../app/assets/js/core/isdev')
const TrafficState = require('../TrafficState')

/**
 * HealthMonitor — tracks node health and self-isolates when necessary.
 *
 * Responsibilities:
 *   • Network interface liveness check during active downloads (3 strikes → passive)
 *   • CPU stress detection via os.loadavg (5 stressed ticks → passive)
 *   • Network interface fingerprinting (detect IP changes → swarm restart)
 *   • Probation management (10 min for stress, 1 h for health issues)
 *
 * Design notes:
 *   • _fingerprint() is computed ONCE per tick and cached as _tickFp to avoid
 *     double syscalls (was previously called in both _checkSeederHealth and
 *     _checkNetworkChange).
 *   • Health self-isolation is based on local interface availability, NOT on
 *     incoming download speed from remote peers — seeder nodes would always
 *     read zero on currentDownloadSpeed and falsely self-isolate.
 *   • Uses recursive setTimeout internally so a slow callback never causes
 *     overlapping ticks.
 */
class HealthMonitor {
    /**
     * @param {object} opts
     * @param {() => any[]} opts.getPeers       Returns current peer list.
     * @param {() => void}  opts.onReconfigure  Called when swarm should re-announce.
     * @param {() => void}  opts.onRestart      Called when network change detected.
     * @param {number}     [opts.tickMs=30000]  How often health is checked (ms).
     */
    constructor({ getPeers, onReconfigure, onRestart, tickMs = 30_000 }) {
        this._getPeers = getPeers
        this._onReconfigure = onReconfigure
        this._onRestart = onRestart
        this._tickMs = tickMs

        this.passive = false
        this.passiveStart = 0
        /** @type {'stress' | 'health' | null} */
        this.passiveReason = null

        this.selfStrikes = 0
        this.stressScore = 0

        /** @type {string | null} Fingerprint from the previous tick */
        this._lastFingerprint = null

        /** @type {ReturnType<typeof setTimeout> | null} */
        this._timer = null
        this._stopped = false
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    start() {
        if (this._timer || this._stopped) return
        this._schedule()
    }

    destroy() {
        this._stopped = true
        if (this._timer) {
            clearTimeout(this._timer)
            this._timer = null
        }
    }

    // ─── Public state queries ─────────────────────────────────────────────────

    get isPassive() { return this.passive }

    // ─── Private ──────────────────────────────────────────────────────────────

    _schedule() {
        this._timer = setTimeout(() => {
            this._timer = null
            try {
                this._tick()
            } catch (e) {
                console.error('[HealthMonitor] Tick error:', e)
            }
            if (!this._stopped) this._schedule()
        }, this._tickMs)
        if (this._timer && this._timer.unref) this._timer.unref()
    }

    _tick() {
        // Compute fingerprint once per tick — used by both health and change checks
        const currentFp = this._fingerprint()
        this._checkSeederHealth(currentFp)
        this._checkNetworkChange(currentFp)
        this._checkCPUStress()
    }

    /**
     * @param {string} currentFp  Pre-computed fingerprint for this tick
     */
    _checkSeederHealth(currentFp) {
        if (this.passive) {
            const timeout = this.passiveReason === 'stress' ? 600_000 : 3_600_000
            if (Date.now() - this.passiveStart > timeout) {
                console.log(`[HealthMonitor] Probation ended (${this.passiveReason}). Re-enabling active mode.`)
                this.passive = false
                this.selfStrikes = 0
                this.passiveReason = null
                this._onReconfigure()
            }
            return
        }

        // Only check network liveness during active downloads.
        // When idle/seeding-only, currentDownloadSpeed is always 0 — checking it
        // would cause false positives and lock the seeder out of the network.
        if (!TrafficState.isBusy()) {
            if (this.selfStrikes > 0) this.selfStrikes--
            return
        }

        // Self-isolation trigger: our own IPv4 interface has gone away.
        // This indicates a physical disconnect, VPN drop, or OS sleep — situations
        // where continuing to seed makes no sense and would flood peers with errors.
        if (!currentFp) {
            this.selfStrikes++
            if (isDev) console.warn(`[HealthMonitor] No active network interfaces. Strike ${this.selfStrikes}/3.`)
            if (this.selfStrikes >= 3) {
                console.error('[HealthMonitor] Network interface is dead. Self-isolating.')
                this._enterPassive('health')
            }
        } else {
            // Interface is alive — decay strikes (one per tick, not instant reset)
            if (this.selfStrikes > 0) this.selfStrikes--
        }
    }

    /**
     * @param {string} currentFp  Pre-computed fingerprint for this tick
     */
    _checkNetworkChange(currentFp) {
        if (!this._lastFingerprint) {
            this._lastFingerprint = currentFp
            return
        }
        if (currentFp !== this._lastFingerprint) {
            console.log('[HealthMonitor] Network interface change detected. Triggering restart.')
            this._lastFingerprint = currentFp
            this._onRestart()
        }
    }

    _checkCPUStress() {
        const load = os.loadavg()
        const cpus = os.cpus().length
        const stressed = load[0] > cpus * 0.8

        if (stressed) {
            this.stressScore++
            // 5 consecutive stressed ticks at 30 s/tick = 2.5 min sustained >80% load
            if (this.stressScore >= 5 && !this.passive) {
                console.error('[HealthMonitor] CPU STRESS (>80% for sustained period). Switching to Passive Mode.')
                this._enterPassive('stress')
            }
        } else {
            this.stressScore = Math.max(0, this.stressScore - 1)
        }
    }

    _enterPassive(reason) {
        this.passive = true
        this.passiveStart = Date.now()
        this.passiveReason = reason
        this._onReconfigure()
    }

    /**
     * Returns a string fingerprint of all non-internal external IPv4 interfaces.
     * Empty string means no external interfaces are active.
     * @returns {string}
     */
    _fingerprint() {
        const interfaces = os.networkInterfaces()
        const ignoreList = ['awdl', 'utun', 'llw', 'gif', 'stf']
        let fp = ''
        for (const key of Object.keys(interfaces).sort()) {
            if (process.platform === 'darwin' && ignoreList.some(p => key.startsWith(p))) continue
            for (const d of interfaces[key] || []) {
                if (!d.internal && (d.family === 'IPv4' || /** @type {any} */(d.family) === 4)) {
                    fp += `${key}:${d.address}|`
                }
            }
        }
        return fp
    }
}

module.exports = HealthMonitor
