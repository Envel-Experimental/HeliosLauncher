'use strict'

describe('HealthMonitor', () => {
    let HealthMonitor
    let monitor

    // Shared callbacks
    let onReconfigure
    let onRestart

    beforeEach(() => {
        jest.resetModules()
        jest.useFakeTimers()

        jest.doMock('@network/constants', () => ({
            SEEDER_HEALTH_FAST_LIMIT_BPS: 512_000,
            SEEDER_HEALTH_SLOW_LIMIT_BPS: 128_000
        }))

        jest.doMock('@network/TrafficState', () => ({
            isBusy: jest.fn().mockReturnValue(true)
        }))

        HealthMonitor = require('../../../network/services/HealthMonitor')
        onReconfigure = jest.fn()
        onRestart = jest.fn()
    })

    afterEach(() => {
        if (monitor) monitor.destroy()
        jest.useRealTimers()
    })

    // ─── Seeder Health ────────────────────────────────────────────────────────

    describe('Seeder health check', () => {
        it('should NOT enter passive if network interfaces are active', () => {
            monitor = new HealthMonitor({ getPeers: () => [], onReconfigure, onRestart, tickMs: 30_000 })
            monitor._checkSeederHealth('eth0:192.168.1.5|') // non-empty fp = interface alive
            expect(monitor.isPassive).toBe(false)
            expect(monitor.selfStrikes).toBe(0)
        })

        it('should accumulate strikes when network interfaces are dead', () => {
            monitor = new HealthMonitor({ getPeers: () => [], onReconfigure, onRestart, tickMs: 30_000 })
            monitor._checkSeederHealth('') // empty fp = no interface
            expect(monitor.selfStrikes).toBe(1)
        })

        it('should enter passive mode after 3 dead network strikes', () => {
            monitor = new HealthMonitor({ getPeers: () => [], onReconfigure, onRestart, tickMs: 30_000 })
            for (let i = 0; i < 3; i++) monitor._checkSeederHealth('')
            expect(monitor.isPassive).toBe(true)
            expect(monitor.passiveReason).toBe('health')
            expect(onReconfigure).toHaveBeenCalledTimes(1)
        })

        it('should exit passive after 1-hour probation (health)', () => {
            monitor = new HealthMonitor({ getPeers: () => [], onReconfigure, onRestart, tickMs: 30_000 })
            for (let i = 0; i < 3; i++) monitor._checkSeederHealth('')
            expect(monitor.isPassive).toBe(true)

            // Simulate 1 hour passing
            monitor.passiveStart = Date.now() - 3_600_001
            monitor._checkSeederHealth('')
            expect(monitor.isPassive).toBe(false)
            expect(onReconfigure).toHaveBeenCalledTimes(2)
        })

        it('should exit passive after 10-minute probation (stress)', () => {
            monitor = new HealthMonitor({ getPeers: () => [], onReconfigure, onRestart, tickMs: 30_000 })
            monitor._enterPassive('stress')
            expect(monitor.isPassive).toBe(true)

            monitor.passiveStart = Date.now() - 600_001
            monitor._checkSeederHealth('eth0:10.0.0.1|')
            expect(monitor.isPassive).toBe(false)
        })

        it('should decrease strikes when network recovers', () => {
            monitor = new HealthMonitor({ getPeers: () => [], onReconfigure, onRestart, tickMs: 30_000 })
            monitor.selfStrikes = 2
            monitor._checkSeederHealth('eth0:192.168.1.5|') // interface alive
            expect(monitor.selfStrikes).toBe(1)
        })

        it('should NOT strike when idle (TrafficState.isBusy = false)', () => {
            jest.resetModules()
            jest.doMock('@network/TrafficState', () => ({
                isBusy: jest.fn().mockReturnValue(false)
            }))
            const HM = require('../../../network/services/HealthMonitor')
            const m = new HM({ getPeers: () => [], onReconfigure, onRestart })
            m._checkSeederHealth('') // dead interface, but not busy → should decay, not strike
            expect(m.selfStrikes).toBe(0) // was 0 already, no increment
            m.destroy()
        })

        it('should decay selfStrikes when idle', () => {
            jest.resetModules()
            jest.doMock('@network/TrafficState', () => ({
                isBusy: jest.fn().mockReturnValue(false)
            }))
            const HM = require('../../../network/services/HealthMonitor')
            const m = new HM({ getPeers: () => [], onReconfigure, onRestart })
            m.selfStrikes = 2
            m._checkSeederHealth('')
            expect(m.selfStrikes).toBe(1) // decayed
            m.destroy()
        })
    })

    // ─── CPU stress ───────────────────────────────────────────────────────────

    describe('CPU stress detection', () => {
        it('should enter passive after 5 stressed ticks', () => {
            const os = require('os')
            jest.spyOn(os, 'loadavg').mockReturnValue([8, 8, 8])
            jest.spyOn(os, 'cpus').mockReturnValue(new Array(8).fill({}))

            monitor = new HealthMonitor({ getPeers: () => [], onReconfigure, onRestart, tickMs: 30_000 })

            for (let i = 0; i < 5; i++) monitor._checkCPUStress()
            expect(monitor.isPassive).toBe(true)
            expect(monitor.passiveReason).toBe('stress')

            jest.restoreAllMocks()
        })

        it('should decrease stressScore when not stressed', () => {
            const os = require('os')
            jest.spyOn(os, 'loadavg').mockReturnValue([0, 0, 0])
            jest.spyOn(os, 'cpus').mockReturnValue(new Array(8).fill({}))

            monitor = new HealthMonitor({ getPeers: () => [], onReconfigure, onRestart, tickMs: 30_000 })
            monitor.stressScore = 3
            monitor._checkCPUStress()
            expect(monitor.stressScore).toBe(2)

            jest.restoreAllMocks()
        })
    })

    // ─── Network fingerprint ──────────────────────────────────────────────────

    describe('Network fingerprint & restart', () => {
        it('should call onRestart when fingerprint changes', () => {
            monitor = new HealthMonitor({ getPeers: () => [], onReconfigure, onRestart, tickMs: 30_000 })
            monitor._lastFingerprint = 'old-fp'
            monitor._checkNetworkChange('new-fp')
            expect(onRestart).toHaveBeenCalledTimes(1)
        })

        it('should NOT call onRestart when fingerprint is unchanged', () => {
            monitor = new HealthMonitor({ getPeers: () => [], onReconfigure, onRestart, tickMs: 30_000 })
            monitor._lastFingerprint = 'same-fp'
            monitor._checkNetworkChange('same-fp')
            expect(onRestart).not.toHaveBeenCalled()
        })

        it('should initialize fingerprint on first check', () => {
            monitor = new HealthMonitor({ getPeers: () => [], onReconfigure, onRestart, tickMs: 30_000 })
            monitor._checkNetworkChange('fp-init')
            expect(monitor._lastFingerprint).toBe('fp-init')
            expect(onRestart).not.toHaveBeenCalled()
        })

        it('_tick() computes fingerprint once and passes it to both checks', () => {
            monitor = new HealthMonitor({ getPeers: () => [], onReconfigure, onRestart, tickMs: 30_000 })
            const fpSpy = jest.spyOn(monitor, '_fingerprint').mockReturnValue('eth0:1.2.3.4|')
            monitor._tick()
            // _fingerprint must be called EXACTLY once per tick
            expect(fpSpy).toHaveBeenCalledTimes(1)
        })
    })

    // ─── Recursive scheduling ─────────────────────────────────────────────────

    describe('Recursive setTimeout (no overlapping)', () => {
        it('should schedule next tick only after previous completes', () => {
            monitor = new HealthMonitor({ getPeers: () => [], onReconfigure, onRestart, tickMs: 1000 })
            monitor.start()
            expect(monitor._timer).not.toBeNull()

            const firstTimer = monitor._timer
            jest.advanceTimersByTime(1001)
            expect(monitor._timer).not.toBe(firstTimer)
        })

        it('destroy() should cancel the pending timer', () => {
            monitor = new HealthMonitor({ getPeers: () => [], onReconfigure, onRestart, tickMs: 1000 })
            monitor.start()
            monitor.destroy()
            expect(monitor._timer).toBeNull()
            expect(monitor._stopped).toBe(true)
        })
    })
})
