// @ts-check
'use strict'

const os = require('os')
const { EventEmitter } = require('events')

let monitorEventLoopDelay
try {
    monitorEventLoopDelay = require('perf_hooks').monitorEventLoopDelay
} catch (e) {
    // Under browser/renderer environments without Node integration (e.g. tests or custom build targets)
}

/**
 * ResourceMonitor — tracks Node.js process health for the P2P engine.
 *
 * ## Why not os.cpuUsage()?
 *   Node.js is single-threaded. On a 16-core machine, even if the V8 event
 *   loop is 100% saturated on core-0, the system-wide average reads as ~6%.
 *   HealthMonitor would then happily open 32 parallel downloads while the
 *   main thread is already thrashing.
 *
 * ## Solution: Event Loop Delay (ELD)
 *   `perf_hooks.monitorEventLoopDelay` measures the actual time between
 *   successive ticks of libuv's event loop. High ELD means the JS thread is
 *   busy processing callbacks and can't keep up with I/O. This is a much
 *   more accurate signal for a network-intensive Electron app.
 *
 *   Thresholds (conservative):
 *     LOW    < 20 ms mean delay   → All good
 *     MEDIUM 20–50 ms             → Approaching saturation; ease off
 *     HIGH   50–100 ms            → Congested; reduce concurrency
 *     CRITICAL > 100 ms           → Event loop is choking; emergency pause
 *
 * ## Supplemental: system CPU
 *   We still compute per-core system CPU so NodeAdapter's profile detection
 *   has something to compare against on startup (before the ELD histogram
 *   has warmed up). After the first 2 s of monitoring the ELD takes over.
 */
class ResourceMonitor extends EventEmitter {
    constructor() {
        super()

        // ── Event Loop Delay histogram (Node 11.10+) ─────────────────────────
        /** @type {import('perf_hooks').IntervalHistogram | null} */
        this._eldHistogram = null

        // ── System CPU (supplemental only) ───────────────────────────────────
        /** @type {number} 0–100 percent */
        this.cpuUsage = 0
        /** @type {ReturnType<typeof os.cpus>} */
        this.lastCpus = os.cpus()

        /** @type {ReturnType<typeof setInterval> | null} */
        this.interval = null
        this.isMonitoring = false
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    start(intervalMs = 2000) {
        if (this.isMonitoring) return
        this.isMonitoring = true

        // Start the ELD histogram — samples the event loop on every iteration
        if (monitorEventLoopDelay) {
            this._eldHistogram = monitorEventLoopDelay({ resolution: 20 })
            this._eldHistogram.enable()
        }

        this.interval = setInterval(() => this._measureLoop(), intervalMs)
        if (this.interval.unref) this.interval.unref()
    }

    stop() {
        this.isMonitoring = false
        if (this.interval) {
            clearInterval(this.interval)
            this.interval = null
        }
        if (this._eldHistogram) {
            this._eldHistogram.disable()
            this._eldHistogram = null
        }
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /** @returns {number} Raw system CPU usage 0–100 (supplemental) */
    getCPUUsage() {
        return this.cpuUsage
    }

    /**
     * Returns the mean event loop delay in milliseconds.
     * 0 if the histogram has not started yet.
     * @returns {number}
     */
    getEventLoopDelayMs() {
        if (!this._eldHistogram) return 0
        // mean is in nanoseconds
        return this._eldHistogram.mean / 1e6
    }

    /**
     * Primary stress signal for HealthMonitor.
     * Based on ELD when available, system CPU as fallback.
     * @returns {'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'}
     */
    getStressLevel() {
        if (this._eldHistogram) {
            const delayMs = this.getEventLoopDelayMs()
            if (delayMs > 100) return 'CRITICAL'
            if (delayMs > 50)  return 'HIGH'
            if (delayMs > 20)  return 'MEDIUM'
            return 'LOW'
        }
        // Fallback to system CPU (e.g. very old Node or test environment)
        if (this.cpuUsage > 90) return 'CRITICAL'
        if (this.cpuUsage > 70) return 'HIGH'
        if (this.cpuUsage > 50) return 'MEDIUM'
        return 'LOW'
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _measureLoop() {
        // Reset ELD histogram so each interval gives a fresh delta
        if (this._eldHistogram) this._eldHistogram.reset()

        // Supplemental system CPU (all cores averaged)
        const cpus = os.cpus()
        let idle = 0
        let total = 0

        for (let i = 0; i < cpus.length; i++) {
            const cpu = cpus[i]
            const lastCpu = this.lastCpus[i]
            if (lastCpu && lastCpu.times && cpu.times) {
                for (const type in cpu.times) {
                    total += cpu.times[type] - lastCpu.times[type]
                }
                idle += cpu.times.idle - lastCpu.times.idle
            }
        }
        this.lastCpus = cpus

        if (total > 0) {
            this.cpuUsage = 100 - Math.round(100 * idle / total)
        }
    }
}

module.exports = new ResourceMonitor()
