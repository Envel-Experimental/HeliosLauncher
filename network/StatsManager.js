// @ts-check
'use strict'

const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')

/**
 * StatsManager — tracks P2P upload/download totals and per-day history.
 *
 * Design notes:
 *   • `record()` is called on every chunk from PeerHandler and P2PEngine.
 *     It must be synchronous and blazing-fast (no I/O in the hot path).
 *   • `saveAsync()` is called at most once every 30 s and writes via a
 *     temp-file rename to guarantee atomicity (no half-written JSON on crash).
 *   • `isSaving` flag prevents concurrent writes (write-then-rename is not
 *     re-entrant safe on Windows due to file locking).
 *   • History is capped at 365 entries (one per day) to prevent unbounded growth.
 */
class StatsManager extends EventEmitter {
    constructor() {
        super()
        /** @type {string|null} */
        this.statsPath = null
        this.data = {
            totalUploaded: 0,
            totalDownloaded: 0,
            /** @type {Array<{ date: string, up: number, down: number }>} */
            history: []
        }
        this.lastSave = 0
        this.isSaving = false
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    init(launcherDir) {
        this.statsPath = path.join(launcherDir, 'p2pstats.json')
        this.load()
    }

    // ─── Persistence ──────────────────────────────────────────────────────────

    load() {
        if (!this.statsPath) return
        try {
            if (fs.existsSync(this.statsPath)) {
                const raw = fs.readFileSync(this.statsPath, 'utf-8')
                const parsed = JSON.parse(raw)
                this.data = { ...this.data, ...parsed }
            }
        } catch (e) {
            console.error('[StatsManager] Failed to load stats:', e)
        }
    }

    /**
     * Atomically writes stats to disk via a temp-file rename.
     * Non-blocking: uses fs.promises so the event loop is never stalled.
     * A guard flag prevents concurrent writes (safe on Windows).
     */
    async saveAsync() {
        if (!this.statsPath || this.isSaving) return
        this.isSaving = true
        this.lastSave = Date.now()

        const tempPath = this.statsPath + '.tmp'
        try {
            await fs.promises.writeFile(tempPath, JSON.stringify(this.data, null, 2), 'utf-8')
            await fs.promises.rename(tempPath, this.statsPath)
        } catch (e) {
            console.error('[StatsManager] Failed to save stats:', e)
            // Clean up orphaned temp file if rename failed
            try { await fs.promises.unlink(tempPath) } catch (_) {}
        } finally {
            this.isSaving = false
        }
    }

    // ─── Hot-path recording ───────────────────────────────────────────────────

    /**
     * Record a chunk's traffic. Called on every chunk — must be O(1) with no I/O.
     * @param {number} uploaded   Bytes uploaded this chunk
     * @param {number} downloaded Bytes downloaded this chunk
     */
    record(uploaded, downloaded) {
        this.data.totalUploaded += uploaded
        this.data.totalDownloaded += downloaded

        const today = new Date().toISOString().split('T')[0]
        let dayEntry = this.data.history.find(h => h.date === today)
        if (!dayEntry) {
            dayEntry = { date: today, up: 0, down: 0 }
            this.data.history.push(dayEntry)
            // Evict entries older than 365 days (oldest first — array is chronological)
            if (this.data.history.length > 365) this.data.history.shift()
        }
        dayEntry.up += uploaded
        dayEntry.down += downloaded

        // Trigger async save at most once per 30 s. Fire-and-forget intentionally:
        // losing a few seconds of stats on a crash is acceptable.
        if (Date.now() - this.lastSave > 30_000) {
            this.saveAsync().catch(() => {})
        }
    }

    /**
     * @param {number} bytes
     * @param {'up'|'down'} direction
     */
    recordTraffic(bytes, direction) {
        if (direction === 'up') {
            this.record(bytes, 0)
        } else {
            this.record(0, bytes)
        }
    }

    // ─── Query ────────────────────────────────────────────────────────────────

    /**
     * @param {'all'|'week'|'month'} filter
     * @returns {{ up: number, down: number }}
     */
    getStats(filter = 'all') {
        const now = new Date()
        let filteredHistory = this.data.history

        if (filter === 'week') {
            const weekAgo = new Date()
            weekAgo.setDate(now.getDate() - 7)
            filteredHistory = this.data.history.filter(h => new Date(h.date) >= weekAgo)
        } else if (filter === 'month') {
            const monthAgo = new Date()
            monthAgo.setMonth(now.getMonth() - 1)
            filteredHistory = this.data.history.filter(h => new Date(h.date) >= monthAgo)
        }

        const sumUp   = filteredHistory.reduce((acc, h) => acc + h.up, 0)
        const sumDown = filteredHistory.reduce((acc, h) => acc + h.down, 0)

        return {
            up:   filter === 'all' ? this.data.totalUploaded   : sumUp,
            down: filter === 'all' ? this.data.totalDownloaded : sumDown
        }
    }

    getFullStats() {
        return {
            all:   this.getStats('all'),
            month: this.getStats('month'),
            week:  this.getStats('week')
        }
    }
}

module.exports = new StatsManager()
