'use strict'

/**
 * ResourceMonitor tests.
 *
 * Bugs covered:
 *   1. getCPUUsage() aggregated all cores and returned ~6% when one core was
 *      at 100% on a 16-core machine. Useless for a single-threaded Node process.
 *      FIX: getStressLevel() now uses Event Loop Delay (ELD) via perf_hooks as
 *      primary signal, with system CPU as fallback.
 *
 *   2. stop() did not disable the ELD histogram → memory/resource leak.
 */
describe('ResourceMonitor', () => {
    let ResourceMonitor
    let mockHistogram

    beforeEach(() => {
        jest.resetModules()

        mockHistogram = {
            enable: jest.fn(),
            disable: jest.fn(),
            reset: jest.fn(),
            mean: 0 // nanoseconds
        }

        jest.doMock('perf_hooks', () => ({
            monitorEventLoopDelay: jest.fn(() => mockHistogram)
        }))

        ResourceMonitor = require('../../../network/ResourceMonitor')
    })

    afterEach(() => {
        ResourceMonitor.stop()
        jest.restoreAllMocks()
    })

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    it('start() creates and enables the ELD histogram', () => {
        ResourceMonitor.start(500)
        expect(mockHistogram.enable).toHaveBeenCalledTimes(1)
        expect(ResourceMonitor.isMonitoring).toBe(true)
    })

    it('start() is idempotent (no double-start)', () => {
        const { monitorEventLoopDelay } = require('perf_hooks')
        ResourceMonitor.start(500)
        ResourceMonitor.start(500) // second call should no-op
        expect(monitorEventLoopDelay).toHaveBeenCalledTimes(1)
    })

    it('stop() disables the ELD histogram (no resource leak)', () => {
        ResourceMonitor.start(500)
        ResourceMonitor.stop()
        expect(mockHistogram.disable).toHaveBeenCalledTimes(1)
        expect(ResourceMonitor._eldHistogram).toBeNull()
        expect(ResourceMonitor.isMonitoring).toBe(false)
    })

    it('stop() clears the setInterval', () => {
        jest.useFakeTimers()
        ResourceMonitor.start(500)
        expect(ResourceMonitor.interval).not.toBeNull()
        ResourceMonitor.stop()
        expect(ResourceMonitor.interval).toBeNull()
        jest.useRealTimers()
    })

    // ─── getEventLoopDelayMs() ────────────────────────────────────────────────

    it('getEventLoopDelayMs() converts nanoseconds to milliseconds', () => {
        ResourceMonitor.start(500)
        mockHistogram.mean = 50_000_000 // 50ms in ns
        expect(ResourceMonitor.getEventLoopDelayMs()).toBeCloseTo(50, 0)
    })

    it('getEventLoopDelayMs() returns 0 when not monitoring', () => {
        expect(ResourceMonitor.getEventLoopDelayMs()).toBe(0)
    })

    // ─── getStressLevel() — ELD-based ────────────────────────────────────────

    it('getStressLevel() returns LOW when ELD < 20ms', () => {
        ResourceMonitor.start(500)
        mockHistogram.mean = 10_000_000 // 10ms
        expect(ResourceMonitor.getStressLevel()).toBe('LOW')
    })

    it('getStressLevel() returns MEDIUM when ELD 20-50ms', () => {
        ResourceMonitor.start(500)
        mockHistogram.mean = 35_000_000 // 35ms
        expect(ResourceMonitor.getStressLevel()).toBe('MEDIUM')
    })

    it('getStressLevel() returns HIGH when ELD 50-100ms', () => {
        ResourceMonitor.start(500)
        mockHistogram.mean = 75_000_000 // 75ms
        expect(ResourceMonitor.getStressLevel()).toBe('HIGH')
    })

    it('getStressLevel() returns CRITICAL when ELD > 100ms', () => {
        ResourceMonitor.start(500)
        mockHistogram.mean = 150_000_000 // 150ms
        expect(ResourceMonitor.getStressLevel()).toBe('CRITICAL')
    })

    // ─── REGRESSION: 16-core false-negative ──────────────────────────────────

    it('REGRESSION: ELD correctly detects saturation even on a 16-core machine', () => {
        // Old code: 100% load on 1 core out of 16 → reported 6% system CPU → LOW.
        // New code: ELD > 100ms → CRITICAL regardless of core count.
        ResourceMonitor.start(500)
        mockHistogram.mean = 120_000_000 // 120ms ELD — event loop is choking
        // This would have returned LOW/MEDIUM with the old system-CPU approach
        expect(ResourceMonitor.getStressLevel()).toBe('CRITICAL')
    })

    // ─── Fallback: system CPU (when ELD unavailable) ──────────────────────────

    it('getStressLevel() falls back to system CPU when histogram is null', () => {
        // Don't call start() — histogram stays null
        ResourceMonitor.cpuUsage = 95
        expect(ResourceMonitor.getStressLevel()).toBe('CRITICAL')

        ResourceMonitor.cpuUsage = 75
        expect(ResourceMonitor.getStressLevel()).toBe('HIGH')

        ResourceMonitor.cpuUsage = 55
        expect(ResourceMonitor.getStressLevel()).toBe('MEDIUM')

        ResourceMonitor.cpuUsage = 30
        expect(ResourceMonitor.getStressLevel()).toBe('LOW')
    })

    // ─── _measureLoop() CPU calculation ───────────────────────────────────────

    it('_measureLoop() updates cpuUsage to a 0-100 value', () => {
        jest.useFakeTimers()
        ResourceMonitor.start(100)
        jest.advanceTimersByTime(150) // fire one interval
        // cpuUsage is bounded — may be 0 in test env but must be numeric
        expect(typeof ResourceMonitor.cpuUsage).toBe('number')
        expect(ResourceMonitor.cpuUsage).toBeGreaterThanOrEqual(0)
        expect(ResourceMonitor.cpuUsage).toBeLessThanOrEqual(100)
        jest.useRealTimers()
    })
})
