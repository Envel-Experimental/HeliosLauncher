// @ts-check
'use strict'

const os = require('os')
const isDev = require('../../app/assets/js/core/isdev')
const NodeAdapter = require('../NodeAdapter')
const RateLimiter = require('../../app/assets/js/core/util/RateLimiter')
const StatsManager = require('../StatsManager')
const {
    MIN_UPLOAD_LIMIT_MBPS,
    RTT_CONGESTION_DELTA_MS,
    STEP_UP_INTERVAL_MS,
    ADDITIVE_INCREASE_MBPS,
    SLOW_START_MULTIPLIER,
    MAX_ADAPTIVE_SLOTS,
    MIN_PARALLEL_DOWNLOADS,
    MAX_PARALLEL_DOWNLOADS,
    PEER_CONCURRENCY_FACTOR
} = require('../constants')

const ConfigManager = require('../../app/assets/js/core/configmanager')
const ResourceMonitor = require('../ResourceMonitor')

/**
 * BandwidthManager — owns all bandwidth-related state and algorithms.
 *
 * Responsibilities:
 *   • Real-time speed measurement (upload / download, local / global)
 *   • AIMD / slow-start upload limit management
 *   • Congestion detection via WAN peer RTT deltas
 *   • Adaptive slot count (`adaptiveSlotCount`)
 *   • High-bandwidth mode detection
 *   • Stats reporting to StatsManager
 *
 * Uses **recursive setTimeout** so a slow callback never causes overlapping ticks.
 */
class BandwidthManager {
    /**
     * @param {object} opts
     * @param {() => any[]} opts.getPeers  Returns current peer list.
     * @param {number}     [opts.tickMs=2000]
     */
    constructor({ getPeers, tickMs = 2000 }) {
        this._getPeers = getPeers
        this._tickMs = tickMs

        // ── Byte accumulators (reset each tick) ──
        this.downloadBytesLocal = 0
        this.downloadBytesGlobal = 0
        this.uploadBytesLocal = 0
        this.uploadBytesGlobal = 0

        // ── Speed (bytes/sec, calculated each tick) ──
        this.downloadSpeed = 0
        this.uploadSpeed = 0
        this.downloadSpeedLocal = 0
        this.uploadSpeedLocal = 0
        this.maxObservedDownloadSpeed = 0

        // ── Totals (cumulative) ──
        this.totalUploadedLocal = 0
        this.totalUploadedGlobal = 0
        this.totalDownloadedLocal = 0
        this.totalDownloadedGlobal = 0
        this.totalUploaded = 0
        this.totalDownloaded = 0

        // ── AIMD state ──
        this.currentUploadLimitMbps = this._initialLimit()
        this.lastStableLimit = 0
        this.slowStart = true
        this.congestionDetected = false
        this.lastStepUpTime = Date.now()
        this.lastLimitUpdate = 0

        // ── Upload slots ──
        this.adaptiveSlotCount = MAX_ADAPTIVE_SLOTS

        // ── High-bandwidth detection ──
        this.highBandwidthMode = false

        // ── Internal ──
        /** @type {ReturnType<typeof setTimeout> | null} */
        this._timer = null
        this._stopped = false
        /** @type {number} */
        this._lastFinalLimit = -1
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    start() {
        if (this._timer || this._stopped) return
        ResourceMonitor.start()
        this._schedule()
    }

    destroy() {
        this._stopped = true
        if (this._timer) {
            clearTimeout(this._timer)
            this._timer = null
        }
        ResourceMonitor.stop()
    }

    // ─── Congestion callbacks (called from PeerHandler via P2PEngine) ─────────

    /**
     * @param {any}    _peer unused but kept for future use
     * @param {number} _rtt
     */
    onPeerRTTUpdate(_peer, _rtt) {
        // RTT data is collected per-peer in the peer object.
        // The actual congestion check runs during _tick → _updateLimits.
    }

    triggerCongestionBackoff() {
        this.lastStableLimit = this.currentUploadLimitMbps
        this.currentUploadLimitMbps = Math.max(MIN_UPLOAD_LIMIT_MBPS, this.currentUploadLimitMbps * 0.5)
        this.slowStart = false
        this.lastStepUpTime = Date.now() + 10_000
        this._applyLimit(true)
    }

    // ─── Getters (read by P2PEngine / QueueProcessor) ────────────────────────

    getLoadStatus() {
        const peers = this._getPeers()
        const active = peers.reduce((acc, p) => acc + (p.activeStreams || 0), 0)
        return active > 32 ? 'overloaded' : 'normal'
    }

    /**
     * @param {number} baseLimit
     * @returns {number}
     */
    getOptimalConcurrency(baseLimit) {
        const peers = this._getPeers()
        let dynamic = baseLimit
        if (peers.length > 0) {
            dynamic = Math.max(MIN_PARALLEL_DOWNLOADS, peers.length * PEER_CONCURRENCY_FACTOR)
        }

        const cpu = ResourceMonitor.getCPUUsage()
        let stressLimit = MAX_PARALLEL_DOWNLOADS
        if (cpu > 90) stressLimit = 8
        else if (cpu > 70) stressLimit = 16
        else if (cpu > 50) stressLimit = 24

        if (this.getLoadStatus() === 'overloaded') stressLimit = Math.min(stressLimit, 12)

        const final = Math.min(dynamic, stressLimit)
        return Math.max(MIN_PARALLEL_DOWNLOADS, Math.min(MAX_PARALLEL_DOWNLOADS, final))
    }

    // ─── Private — tick ──────────────────────────────────────────────────────

    _schedule() {
        this._timer = setTimeout(() => {
            this._timer = null
            try {
                this._tick()
            } catch (e) {
                console.error('[BandwidthManager] Tick error:', e)
            }
            if (!this._stopped) this._schedule()
        }, this._tickMs)
        if (this._timer && this._timer.unref) this._timer.unref()
    }

    _tick() {
        const interval = this._tickMs / 1000 // seconds

        // ── Calculate speeds ──
        this.downloadSpeed = this.downloadBytesGlobal / interval
        this.uploadSpeed = this.uploadBytesGlobal / interval
        this.downloadSpeedLocal = this.downloadBytesLocal / interval
        this.uploadSpeedLocal = this.uploadBytesLocal / interval

        if (this.downloadSpeed > this.maxObservedDownloadSpeed) {
            this.maxObservedDownloadSpeed = this.downloadSpeed
        }

        // ── High-bandwidth detection (> 10 MB/s) ──
        if (this.downloadSpeed > 10 * 1024 * 1024 && !this.highBandwidthMode) {
            this.highBandwidthMode = true
            if (isDev) console.log('[BandwidthManager] High Bandwidth Mode activated (>10 MB/s)')
        }

        // ── Record to StatsManager ──
        const up = this.uploadBytesGlobal + this.uploadBytesLocal
        const down = this.downloadBytesGlobal + this.downloadBytesLocal
        if (up > 0 || down > 0) StatsManager.record(up, down)

        // ── Reset accumulators ──
        this.downloadBytesLocal = 0
        this.downloadBytesGlobal = 0
        this.uploadBytesLocal = 0
        this.uploadBytesGlobal = 0

        // ── Congestion check via WAN peer RTT deltas (runs every tick: 2s) ──
        const peers = this._getPeers()
        const wanPeers = peers.filter(p => !p.isLocal() && p.rtt > 0)
        let isCongested = false
        if (wanPeers.length > 0) {
            const deltas = wanPeers
                .map(p => p.rtt - (/** @type {any} */(p).baselineRTT || p.rtt))
                .sort((a, b) => a - b)
            const median = deltas[Math.floor(deltas.length / 2)]
            if (median > RTT_CONGESTION_DELTA_MS) {
                isCongested = true
                if (!this.congestionDetected) {
                    if (isDev) console.warn(`[BandwidthManager] Congestion detected (RTT delta ${median}ms). Backoff.`)
                    this.congestionDetected = true
                    this.triggerCongestionBackoff()
                }
            }
        }
        if (!isCongested) {
            this.congestionDetected = false
        }

        // ── Periodically update upload limits (every 30 s) ──
        const now = Date.now()
        if (now - this.lastLimitUpdate > 30_000) {
            this._updateLimits()
            this.lastLimitUpdate = now
        }
    }

    _updateLimits(force = false) {
        if (!ConfigManager.isLoaded() || !ConfigManager.getP2PUploadEnabled()) return

        const userMax = Math.max(1, ConfigManager.getP2PUploadLimit())
        const now = Date.now()

        // ── 1. Step-up (AIMD / slow-start) ──
        if (!this.congestionDetected && now - this.lastStepUpTime > STEP_UP_INTERVAL_MS) {
            if (this.currentUploadLimitMbps < userMax) {
                if (this.slowStart) {
                    this.currentUploadLimitMbps = Math.min(userMax, this.currentUploadLimitMbps * SLOW_START_MULTIPLIER)
                } else {
                    this.currentUploadLimitMbps = Math.min(userMax, this.currentUploadLimitMbps + ADDITIVE_INCREASE_MBPS)
                }
                this.lastStepUpTime = now
                if (this.currentUploadLimitMbps > this.lastStableLimit) {
                    this.lastStableLimit = this.currentUploadLimitMbps
                }
            } else if (this.currentUploadLimitMbps > userMax) {
                this.currentUploadLimitMbps = userMax
            }
        }

        // ── 2. Hardware profile & stress limits ──
        const profile = NodeAdapter.getProfile()
        const load = os.loadavg()
        const cpus = os.cpus().length
        const stressed = load[0] > cpus * 0.8

        let hardwareMax = userMax
        if (profile.name === 'LOW') hardwareMax = 0
        else if (profile.name === 'MID') hardwareMax = Math.min(hardwareMax, 5)
        if (stressed) hardwareMax = Math.min(hardwareMax, 2)

        // Capping AIMD internal state so that it doesn't run away to infinity when limited by hardware constraints
        this.currentUploadLimitMbps = Math.min(this.currentUploadLimitMbps, hardwareMax)

        this.adaptiveSlotCount = MAX_ADAPTIVE_SLOTS

        this._applyLimit(force, this.currentUploadLimitMbps)
    }

    /**
     * @param {boolean} force
     * @param {number} [limitMbps]
     */
    _applyLimit(force, limitMbps) {
        const final = typeof limitMbps === 'number' ? limitMbps : this.currentUploadLimitMbps
        RateLimiter.update(final * 125_000, true)
        if (isDev && (force || final !== this._lastFinalLimit)) {
            console.debug(`[BandwidthManager] Upload limit: ${final.toFixed(1)} Mbps (slots: ${this.adaptiveSlotCount})`)
            this._lastFinalLimit = final
        }
    }

    _initialLimit() {
        const userMax = ConfigManager.isLoaded() ? ConfigManager.getP2PUploadLimit() : 15
        return this.lastStableLimit > 0
            ? Math.max(1, Math.min(userMax, this.lastStableLimit * 0.5))
            : Math.min(userMax, 5)
    }
}

module.exports = BandwidthManager
