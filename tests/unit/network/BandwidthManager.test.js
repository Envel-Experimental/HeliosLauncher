'use strict'

describe('BandwidthManager', () => {
    let BandwidthManager
    let bm

    const NO_PEERS = () => []
    const SLOW_PEERS = () => [{ isLocal: () => false, rtt: 100, baselineRTT: 50 }] // delta = 50ms

    beforeEach(() => {
        jest.resetModules()
        jest.useFakeTimers()

        jest.doMock('@network/constants', () => ({
            MIN_UPLOAD_LIMIT_MBPS: 1,
            MAX_UPLOAD_LIMIT_MBPS: 15,
            RTT_CONGESTION_DELTA_MS: 50,
            STEP_UP_INTERVAL_MS: 5_000,
            ADDITIVE_INCREASE_MBPS: 0.5,
            SLOW_START_MULTIPLIER: 1.5,
            MAX_ADAPTIVE_SLOTS: 6,
            MIN_PARALLEL_DOWNLOADS: 8,
            MAX_PARALLEL_DOWNLOADS: 32,
            PEER_CONCURRENCY_FACTOR: 8
        }))

        jest.doMock('@network/NodeAdapter', () => ({
            getProfile: jest.fn().mockReturnValue({ name: 'HIGH', maxPeers: 30 }),
            isCritical: jest.fn().mockReturnValue(false)
        }))

        jest.doMock('@network/ResourceMonitor', () => ({
            start: jest.fn(),
            stop: jest.fn(),
            getCPUUsage: jest.fn().mockReturnValue(10) // low CPU
        }))

        jest.doMock('@network/StatsManager', () => ({
            record: jest.fn()
        }))

        jest.doMock('@app/assets/js/core/util/RateLimiter', () => ({
            update: jest.fn()
        }))

        jest.doMock('@core/configmanager', () => ({
            isLoaded: jest.fn().mockReturnValue(true),
            getP2PUploadEnabled: jest.fn().mockReturnValue(true),
            getP2PUploadLimit: jest.fn().mockReturnValue(15)
        }))

        BandwidthManager = require('../../../network/services/BandwidthManager')
    })

    afterEach(() => {
        if (bm) bm.destroy()
        jest.useRealTimers()
    })

    // ─── AIMD logic ───────────────────────────────────────────────────────────

    describe('Slow Start', () => {
        it('should multiply limit by 1.5x in slow-start mode', () => {
            bm = new BandwidthManager({ getPeers: NO_PEERS })
            bm.currentUploadLimitMbps = 5
            bm.slowStart = true
            bm.congestionDetected = false
            bm.lastStepUpTime = 0 // allow step-up immediately

            bm._updateLimits()
            expect(bm.currentUploadLimitMbps).toBeCloseTo(7.5)
        })

        it('should additive-increase after slow-start', () => {
            bm = new BandwidthManager({ getPeers: NO_PEERS })
            bm.currentUploadLimitMbps = 5
            bm.slowStart = false
            bm.congestionDetected = false
            bm.lastStepUpTime = 0

            bm._updateLimits()
            expect(bm.currentUploadLimitMbps).toBeCloseTo(5.5)
        })

        it('should NOT exceed user max limit', () => {
            bm = new BandwidthManager({ getPeers: NO_PEERS })
            bm.currentUploadLimitMbps = 14.9
            bm.slowStart = true
            bm.lastStepUpTime = 0

            bm._updateLimits()
            expect(bm.currentUploadLimitMbps).toBeLessThanOrEqual(15)
        })
    })

    describe('Congestion Backoff', () => {
        it('triggerCongestionBackoff should halve the limit', () => {
            bm = new BandwidthManager({ getPeers: NO_PEERS })
            bm.currentUploadLimitMbps = 10

            bm.triggerCongestionBackoff()
            expect(bm.currentUploadLimitMbps).toBeCloseTo(5)
            expect(bm.slowStart).toBe(false)
        })

        it('should detect congestion via WAN RTT delta', () => {
            // Peer with delta = 51ms (strictly > RTT_CONGESTION_DELTA_MS=50 → triggers backoff)
            const peers = [{ isLocal: () => false, rtt: 101, baselineRTT: 50 }]
            bm = new BandwidthManager({ getPeers: () => peers })
            bm.currentUploadLimitMbps = 10
            bm.lastStepUpTime = 0

            const backoffSpy = jest.spyOn(bm, 'triggerCongestionBackoff')
            bm._tick()
            expect(backoffSpy).toHaveBeenCalledTimes(1)
        })

        it('should NOT trigger backoff when delta is below threshold', () => {
            const peers = [{ isLocal: () => false, rtt: 80, baselineRTT: 50 }] // delta=30ms < 50ms
            bm = new BandwidthManager({ getPeers: () => peers })
            bm.currentUploadLimitMbps = 10
            bm.lastStepUpTime = 0

            const backoffSpy = jest.spyOn(bm, 'triggerCongestionBackoff')
            bm._tick()
            expect(backoffSpy).not.toHaveBeenCalled()
        })

        it('limit should not go below MIN_UPLOAD_LIMIT_MBPS on backoff', () => {
            bm = new BandwidthManager({ getPeers: NO_PEERS })
            bm.currentUploadLimitMbps = 1 // already at min

            bm.triggerCongestionBackoff()
            expect(bm.currentUploadLimitMbps).toBe(1) // MIN_UPLOAD_LIMIT_MBPS
        })
    })

    // ─── Speed measurement ────────────────────────────────────────────────────

    describe('Speed calculation', () => {
        it('should calculate correct speed per second', () => {
            bm = new BandwidthManager({ getPeers: NO_PEERS, tickMs: 2000 })
            bm.downloadBytesGlobal = 10_000_000 // 10 MB in 2 s = 5 MB/s

            bm._tick()
            expect(bm.downloadSpeed).toBe(5_000_000)
        })

        it('should reset byte accumulators after tick', () => {
            bm = new BandwidthManager({ getPeers: NO_PEERS })
            bm.downloadBytesGlobal = 1024
            bm.uploadBytesLocal = 512

            bm._tick()
            expect(bm.downloadBytesGlobal).toBe(0)
            expect(bm.uploadBytesLocal).toBe(0)
        })

        it('should detect high-bandwidth mode above 10 MB/s', () => {
            bm = new BandwidthManager({ getPeers: NO_PEERS, tickMs: 1000 })
            bm.downloadBytesGlobal = 11 * 1024 * 1024 // 11 MB/s

            bm._tick()
            expect(bm.highBandwidthMode).toBe(true)
        })
    })

    // ─── Optimal concurrency ──────────────────────────────────────────────────

    describe('getOptimalConcurrency', () => {
        it('should scale with peer count', () => {
            const peers = new Array(4).fill({ activeStreams: 0 })
            bm = new BandwidthManager({ getPeers: () => peers })
            // 4 peers * 8 factor = 32, capped at MAX_PARALLEL_DOWNLOADS=32
            const result = bm.getOptimalConcurrency(8)
            expect(result).toBe(32)
        })

        it('should return MIN_PARALLEL_DOWNLOADS when no peers', () => {
            bm = new BandwidthManager({ getPeers: NO_PEERS })
            const result = bm.getOptimalConcurrency(8)
            expect(result).toBe(8) // MIN_PARALLEL_DOWNLOADS
        })
    })

    // ─── Recursive scheduling ─────────────────────────────────────────────────

    describe('Recursive setTimeout (no overlap)', () => {
        it('should schedule next tick after current completes', () => {
            bm = new BandwidthManager({ getPeers: NO_PEERS, tickMs: 1000 })
            bm.start()
            expect(bm._timer).not.toBeNull()

            const first = bm._timer
            jest.advanceTimersByTime(1001)
            expect(bm._timer).not.toBe(first)
        })

        it('destroy() should stop scheduling', () => {
            bm = new BandwidthManager({ getPeers: NO_PEERS, tickMs: 1000 })
            bm.start()
            bm.destroy()
            expect(bm._timer).toBeNull()
            expect(bm._stopped).toBe(true)
        })
    })
})
