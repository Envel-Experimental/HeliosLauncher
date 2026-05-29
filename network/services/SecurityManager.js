// @ts-check
'use strict'

const isDev = require('../../app/assets/js/core/isdev')
const UsageTracker = require('../UsageTracker')
const {
    BLACKLIST_DURATION_MS,
    STRIKE_EXPIRY_MS
} = require('../constants')

/**
 * SecurityManager — owns all threat-related state for the P2P layer:
 *   • IP/key blacklist with auto-expiry
 *   • Strike counter (3 strikes → blacklist)
 *   • Fair-usage token bucket (UsageTracker)
 *   • Global circuit breaker (panic mode)
 *
 * It is intentionally free of network I/O and Hyperswarm knowledge so it can
 * be unit-tested in isolation.
 */
class SecurityManager {
    constructor() {
        /** @type {Set<string>} */
        this.blacklist = new Set()
        /** @type {Map<string, number>} */
        this.strikes = new Map()
        /** @type {Map<string, ReturnType<typeof setTimeout>>} */
        this.blacklistTimeouts = new Map()

        this.usageTracker = new UsageTracker()

        this.panicMode = false
        this.attackCounter = 0

        /** @type {ReturnType<typeof setTimeout> | null} */
        this._panicTimer = null
        /** @type {ReturnType<typeof setInterval> | null} */
        this._cleanupInterval = null
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * Start periodic memory cleanup (UsageTracker + strike expiry).
     * @param {number} intervalMs
     */
    start(intervalMs = 300_000) {
        if (this._cleanupInterval) return
        this._cleanupInterval = setInterval(() => this._periodicCleanup(), intervalMs)
        if (this._cleanupInterval.unref) this._cleanupInterval.unref()
    }

    destroy() {
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval)
            this._cleanupInterval = null
        }
        if (this._panicTimer) {
            clearTimeout(this._panicTimer)
            this._panicTimer = null
        }
        for (const t of this.blacklistTimeouts.values()) clearTimeout(t)
        this.blacklistTimeouts.clear()
    }

    // ─── Query ────────────────────────────────────────────────────────────────

    /** @param {string} peerId */
    isBlacklisted(peerId) {
        return this.blacklist.has(peerId)
    }

    // ─── Strike system ────────────────────────────────────────────────────────

    /**
     * Add a strike against a peer. Returns true if the peer was blacklisted.
     * @param {string} peerId
     * @returns {boolean}
     */
    addStrike(peerId) {
        const count = (this.strikes.get(peerId) || 0) + 1
        this.strikes.set(peerId, count)

        if (isDev) console.warn(`[SecurityManager] Strike ${count}/3 for peer ${peerId}`)

        if (count >= 3) {
            this._blacklist(peerId)
            return true
        }
        return false
    }

    /**
     * Penalize a peer: optionally add strike, always signal a disconnect.
     * Returns true if the peer was blacklisted.
     *
     * @param {string} peerId
     * @param {boolean} isMalicious
     * @returns {boolean} whether the peer was blacklisted
     */
    penalize(peerId, isMalicious) {
        if (!isMalicious) {
            if (isDev) console.log(`[SecurityManager] Disconnecting ${peerId} (non-malicious, no penalty)`)
            return false
        }
        return this.addStrike(peerId)
    }

    // ─── Circuit breaker ──────────────────────────────────────────────────────

    /**
     * Record an attack event. When 5+ events accumulate, the engine is
     * temporarily stopped (panic mode). Calls `onPanic` / `onResume` callbacks.
     *
     * @param {() => void} onPanic  Called when panic mode activates.
     * @param {() => void} onResume Called when panic mode deactivates.
     */
    triggerCircuitBreaker(onPanic, onResume) {
        if (this.panicMode) return

        this.attackCounter++
        if (this.attackCounter < 5) return

        console.error('[SecurityManager] CIRCUIT BREAKER: 5+ attacks detected. Activating panic mode for 5 min.')
        this.panicMode = true
        onPanic()

        this._panicTimer = setTimeout(() => {
            this._panicTimer = null
            this.panicMode = false
            this.attackCounter = 0
            onResume()
        }, 300_000)
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    /** @param {string} peerId */
    _blacklist(peerId) {
        console.error(`[SecurityManager] BLACKLISTING ${peerId} for ${BLACKLIST_DURATION_MS / 60000} min.`)
        this.blacklist.add(peerId)
        this.strikes.delete(peerId) // Reset strike counter

        // Clear any existing timer
        const existing = this.blacklistTimeouts.get(peerId)
        if (existing) clearTimeout(existing)

        const timer = setTimeout(() => {
            this.blacklist.delete(peerId)
            this.blacklistTimeouts.delete(peerId)
        }, BLACKLIST_DURATION_MS)
        if (timer.unref) timer.unref()
        this.blacklistTimeouts.set(peerId, timer)
    }

    _periodicCleanup() {
        this.usageTracker.cleanup()

        // Expire all strikes every STRIKE_EXPIRY_MS
        if (!this._lastCleanupTime || Date.now() - this._lastCleanupTime >= STRIKE_EXPIRY_MS) {
            this._lastCleanupTime = Date.now()
            this.strikes.clear()
        }
    }
}

module.exports = SecurityManager
