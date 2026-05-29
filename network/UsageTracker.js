// @ts-check
'use strict'

const { MAX_CREDITS_PER_IP, CREDIT_REGEN_RATE } = require('./constants')

/**
 * Token-bucket fair-usage tracker.
 * Keyed by peer ID (IP or public key hex).
 *
 * - New peers start at 50 % of the bucket cap.
 * - Credits regenerate at CREDIT_REGEN_RATE MB/s.
 * - The internal map is capped at 5 000 entries (LRU eviction).
 */
class UsageTracker {
    constructor() {
        /** @type {Map<string, { credits: number, lastUpdate: number }>} */
        this.data = new Map()
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    /** Evict the oldest entry when the map grows too large. */
    _evictOldest() {
        if (this.data.size < 5000) return
        const firstKey = this.data.keys().next().value
        if (firstKey !== undefined) this.data.delete(firstKey)
    }

    /** Return (and lazily create) an entry, applying time-based regen. */
    _entry(key) {
        let entry = this.data.get(key)
        if (!entry) {
            this._evictOldest()
            entry = { credits: MAX_CREDITS_PER_IP * 0.5, lastUpdate: Date.now() }
            this.data.set(key, entry)
            return entry
        }

        // Apply elapsed-time regen
        const now = Date.now()
        const elapsed = (now - entry.lastUpdate) / 1000
        entry.credits = Math.min(MAX_CREDITS_PER_IP, entry.credits + elapsed * CREDIT_REGEN_RATE)
        entry.lastUpdate = now

        // Refresh Map insertion order for O(1) LRU eviction
        this.data.delete(key)
        this.data.set(key, entry)
        return entry
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Get current credit balance for a key (includes regen).
     * @param {string} key
     * @returns {number}
     */
    getCredits(key) {
        return this._entry(key).credits
    }

    /**
     * Deduct `amountMB` from the key's balance (floor at 0).
     * @param {string} key
     * @param {number} amountMB
     */
    consume(key, amountMB) {
        const entry = this._entry(key)
        const val = (typeof amountMB === 'number' && !isNaN(amountMB)) ? amountMB : 0
        entry.credits = Math.max(0, entry.credits - val)
    }

    /**
     * Reserve `amountMB` if sufficient credits exist.
     * @param {string} key
     * @param {number} amountMB
     * @returns {boolean} true if reserved, false if insufficient balance
     */
    reserve(key, amountMB) {
        const entry = this._entry(key)
        if (entry.credits >= amountMB) {
            entry.credits -= amountMB
            return true
        }
        return false
    }

    /**
     * Return unused credits (capped at MAX_CREDITS_PER_IP).
     * @param {string} key
     * @param {number} amountMB
     */
    refund(key, amountMB) {
        const entry = this.data.get(key)
        if (entry) {
            entry.credits = Math.min(MAX_CREDITS_PER_IP, entry.credits + amountMB)
            // Refresh Map insertion order for O(1) LRU eviction
            this.data.delete(key)
            this.data.set(key, entry)
        }
    }

    /**
     * Remove stale entries — but ONLY if the peer's balance is already at the
     * cap (meaning regen has fully restored it and the record is now redundant).
     *
     * Why this matters:
     *   • A peer that spent 4 GB has a low balance. Evicting that record and
     *     recreating it on re-connect would grant them a free 2.5 GB reset —
     *     a trivial IP-rotation exploit for attackers.
     *   • A peer at full balance is safe to evict because on re-connect they
     *     will be re-created at the same starting value (MAX * 0.5 ≤ MAX).
     *     Actually, at full balance we can evict — the slot is wasteful.
     *
     * Cutoff: 2 hours since last activity AND balance fully regenerated.
     * Regen rate: 0.5 MB/s × 7200 s = 3600 MB.  MAX is 5000 MB.
     * So a drained peer needs ~2.78 h to refill; entries are only evicted
     * when both conditions are true (balance = MAX AND idle ≥ 2 h).
     */
    cleanup() {
        const cutoff = Date.now() - 7_200_000 // 2 hours
        for (const [key, entry] of this.data.entries()) {
            const isIdle      = entry.lastUpdate < cutoff
            const isFullyCapped = entry.credits >= MAX_CREDITS_PER_IP
            if (isIdle && isFullyCapped) {
                this.data.delete(key)
            }
        }
    }
}

module.exports = UsageTracker
