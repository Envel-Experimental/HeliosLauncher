const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')

class StatsManager extends EventEmitter {
    constructor() {
        super()
        this.statsPath = null
        this.data = {
            totalUploaded: 0,
            totalDownloaded: 0,
            history: [] // Array of { date: 'YYYY-MM-DD', up: number, down: number }
        }
        this.lastSave = 0
    }

    init(launcherDir) {
        this.statsPath = path.join(launcherDir, 'p2pstats.json')
        this.load()
    }

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

    save() {
        if (!this.statsPath) return
        try {
            fs.writeFileSync(this.statsPath, JSON.stringify(this.data, null, 2))
            this.lastSave = Date.now()
        } catch (e) {
            console.error('[StatsManager] Failed to save stats:', e)
        }
    }

    record(uploaded, downloaded) {
        this.data.totalUploaded += uploaded
        this.data.totalDownloaded += downloaded

        const today = new Date().toISOString().split('T')[0]
        let dayEntry = this.data.history.find(h => h.date === today)
        if (!dayEntry) {
            dayEntry = { date: today, up: 0, down: 0 }
            this.data.history.push(dayEntry)
            
            // Limit history to 365 days
            if (this.data.history.length > 365) {
                this.data.history.shift()
            }
        }
        dayEntry.up += uploaded
        dayEntry.down += downloaded

        // Save every 30 seconds or if it's been a while
        if (Date.now() - this.lastSave > 30000) {
            this.save()
        }
    }

    recordTraffic(bytes, direction) {
        if (direction === 'up') {
            this.record(bytes, 0)
        } else {
            this.record(0, bytes)
        }
    }

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

        const sumUp = filteredHistory.reduce((acc, h) => acc + h.up, 0)
        const sumDown = filteredHistory.reduce((acc, h) => acc + h.down, 0)

        return {
            up: filter === 'all' ? this.data.totalUploaded : sumUp,
            down: filter === 'all' ? this.data.totalDownloaded : sumDown
        }
    }

    /**
     * Returns a structured object containing all temporal stats for the UI.
     */
    getFullStats() {
        return {
            all: this.getStats('all'),
            month: this.getStats('month'),
            week: this.getStats('week')
        }
    }
}

module.exports = new StatsManager()
