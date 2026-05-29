'use strict'

const path = require('path')
const os = require('os')

/**
 * StatsManager tests.
 *
 * Bugs covered:
 *   1. save() was fs.writeFileSync — blocked event loop for 50-100ms every 30s.
 *      FIX: saveAsync() uses fs.promises.writeFile + atomic rename.
 *   2. No isSaving guard — concurrent saves could corrupt the file on Windows.
 *      FIX: isSaving flag prevents overlapping async writes.
 */
describe('StatsManager', () => {
    let StatsManager
    let fsMock

    beforeEach(() => {
        jest.resetModules()

        fsMock = {
            existsSync: jest.fn().mockReturnValue(false),
            readFileSync: jest.fn(),
            promises: {
                writeFile: jest.fn().mockResolvedValue(undefined),
                rename: jest.fn().mockResolvedValue(undefined),
                unlink: jest.fn().mockResolvedValue(undefined)
            }
        }

        jest.doMock('fs', () => fsMock)

    StatsManager = require('../../../network/StatsManager')
    // Point statsPath at a fake path that won't be written
    // (mocks are set up to intercept all fs calls)
    StatsManager.statsPath = path.join(os.tmpdir(), 'jest-stats-test.json')
    StatsManager.isSaving = false
    StatsManager.lastSave = 0
    StatsManager.data = { totalUploaded: 0, totalDownloaded: 0, history: [] }
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    // ─── Initialization ───────────────────────────────────────────────────────

    it('init() sets statsPath and calls load()', () => {
        StatsManager.statsPath = null
        StatsManager.init(os.tmpdir())
        expect(StatsManager.statsPath).toBe(path.join(os.tmpdir(), 'p2pstats.json'))
    })

    it('load() is a no-op when statsPath is null', () => {
        StatsManager.statsPath = null
        expect(() => StatsManager.load()).not.toThrow()
    })

    it('load() parses existing stats file', () => {
        fsMock.existsSync.mockReturnValue(true)
        fsMock.readFileSync.mockReturnValue(JSON.stringify({
            totalUploaded: 1024,
            totalDownloaded: 2048,
            history: [{ date: '2024-01-01', up: 512, down: 1024 }]
        }))

        StatsManager.statsPath = '/mock/launcher/p2pstats.json'
        StatsManager.load()

        expect(StatsManager.data.totalUploaded).toBe(1024)
        expect(StatsManager.data.totalDownloaded).toBe(2048)
        expect(StatsManager.data.history.length).toBe(1)
    })

    it('load() handles corrupted JSON gracefully (no throw)', () => {
        fsMock.existsSync.mockReturnValue(true)
        fsMock.readFileSync.mockReturnValue('{ not valid json }')
        jest.spyOn(console, 'error').mockImplementation(() => {})

        StatsManager.statsPath = '/mock/launcher/p2pstats.json'
        expect(() => StatsManager.load()).not.toThrow()
    })

    // ─── record() hot path ────────────────────────────────────────────────────

    it('record() accumulates totals in memory synchronously', () => {
        StatsManager.data.totalUploaded = 0
        StatsManager.data.totalDownloaded = 0
        StatsManager.data.history = []

        StatsManager.record(1024, 2048)
        expect(StatsManager.data.totalUploaded).toBe(1024)
        expect(StatsManager.data.totalDownloaded).toBe(2048)
    })

    it('record() creates a day entry and accumulates per-day stats', () => {
        StatsManager.data.history = []
        StatsManager.record(500, 1000)
        expect(StatsManager.data.history.length).toBe(1)

        const today = new Date().toISOString().split('T')[0]
        const day = StatsManager.data.history[0]
        expect(day.date).toBe(today)
        expect(day.up).toBe(500)
        expect(day.down).toBe(1000)

        StatsManager.record(200, 300)
        expect(StatsManager.data.history[0].up).toBe(700)
        expect(StatsManager.data.history[0].down).toBe(1300)
    })

    it('record() evicts oldest day when history exceeds 365 entries', () => {
        StatsManager.data.history = []
        for (let i = 0; i < 365; i++) {
            const d = new Date()
            d.setDate(d.getDate() - (400 - i))
            StatsManager.data.history.push({ date: d.toISOString().split('T')[0], up: i, down: i })
        }
        const firstDate = StatsManager.data.history[0].date

        StatsManager.record(1, 1) // triggers new day → should shift oldest
        const hasFirst = StatsManager.data.history.some(h => h.date === firstDate)
        expect(hasFirst).toBe(false)
        expect(StatsManager.data.history.length).toBeLessThanOrEqual(365)
    })

    // ─── Async save (no blocking) ─────────────────────────────────────────────

    it('saveAsync() uses fs.promises.writeFile (not writeFileSync)', async () => {
        fsMock.promises.writeFile.mockResolvedValue(undefined)
        fsMock.promises.rename.mockResolvedValue(undefined)

        await StatsManager.saveAsync()

        expect(fsMock.promises.writeFile).toHaveBeenCalledWith(
            expect.stringContaining('.tmp'),
            expect.any(String),
            'utf-8'
        )
        expect(fsMock.promises.rename).toHaveBeenCalled()
    })

    it('saveAsync() is a no-op when isSaving=true (prevents concurrent writes)', async () => {
        StatsManager.isSaving = true

        await StatsManager.saveAsync()

        expect(fsMock.promises.writeFile).not.toHaveBeenCalled()
    })

    it('saveAsync() resets isSaving=false in finally even on error', async () => {
        fsMock.promises.writeFile.mockRejectedValue(new Error('disk full'))
        jest.spyOn(console, 'error').mockImplementation(() => {})

        await StatsManager.saveAsync()

        expect(StatsManager.isSaving).toBe(false)
    })

    it('saveAsync() cleans up .tmp file on rename failure', async () => {
        fsMock.promises.writeFile.mockResolvedValue(undefined)
        fsMock.promises.rename.mockRejectedValue(new Error('rename failed'))
        jest.spyOn(console, 'error').mockImplementation(() => {})

        await StatsManager.saveAsync()

        expect(fsMock.promises.unlink).toHaveBeenCalledWith(
            expect.stringContaining('.tmp')
        )
    })

    it('REGRESSION: record() does NOT call writeFileSync (was blocking event loop)', async () => {
        const writeFileSyncSpy = jest.fn()
        fsMock.writeFileSync = writeFileSyncSpy

        // Force threshold to trigger save
        StatsManager.lastSave = 0

        StatsManager.record(100, 200)
        await Promise.resolve()
        await Promise.resolve()

        expect(writeFileSyncSpy).not.toHaveBeenCalled()
    })

    // ─── recordTraffic() ──────────────────────────────────────────────────────

    it('recordTraffic() routes bytes to correct direction', () => {
        StatsManager.data.totalUploaded = 0
        StatsManager.data.totalDownloaded = 0

        StatsManager.recordTraffic(1000, 'up')
        StatsManager.recordTraffic(2000, 'down')

        expect(StatsManager.data.totalUploaded).toBe(1000)
        expect(StatsManager.data.totalDownloaded).toBe(2000)
    })

    // ─── getStats() ───────────────────────────────────────────────────────────

    it('getStats("all") returns totalUploaded and totalDownloaded', () => {
        StatsManager.data.totalUploaded = 99999
        StatsManager.data.totalDownloaded = 12345
        StatsManager.data.history = []

        const stats = StatsManager.getStats('all')
        expect(stats.up).toBe(99999)
        expect(stats.down).toBe(12345)
    })

    it('getStats("week") sums only the last 7 days', () => {
        const today = new Date()
        StatsManager.data.history = [
            { date: new Date(today.getTime() - 8 * 86400000).toISOString().split('T')[0], up: 999, down: 999 }, // 8d ago — excluded
            { date: new Date(today.getTime() - 3 * 86400000).toISOString().split('T')[0], up: 100, down: 200 }, // 3d ago — included
            { date: today.toISOString().split('T')[0], up: 50, down: 75 }                                         // today — included
        ]
        const stats = StatsManager.getStats('week')
        expect(stats.up).toBe(150)
        expect(stats.down).toBe(275)
    })

    it('getFullStats() returns all, month, week breakdowns', () => {
        StatsManager.data.totalUploaded = 0
        StatsManager.data.totalDownloaded = 0
        StatsManager.data.history = []
        const full = StatsManager.getFullStats()
        expect(full).toHaveProperty('all')
        expect(full).toHaveProperty('month')
        expect(full).toHaveProperty('week')
    })
})
