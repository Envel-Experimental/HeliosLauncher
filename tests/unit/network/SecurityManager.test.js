'use strict'

/**
 * Tests for SecurityManager service.
 * All tests run in isolation (no real timers, no network).
 */

describe('SecurityManager', () => {
    let SecurityManager
    let sm

    beforeEach(() => {
        jest.resetModules()
        jest.useFakeTimers()

        // Use actual constants and UsageTracker — no circular mocking
        SecurityManager = require('../../../network/services/SecurityManager')
        sm = new SecurityManager()
    })

    afterEach(() => {
        sm.destroy()
        jest.useRealTimers()
    })

    // ─── Blacklist ─────────────────────────────────────────────────────────────

    describe('Blacklist', () => {
        it('should not be blacklisted initially', () => {
            expect(sm.isBlacklisted('peer1')).toBe(false)
        })

        it('should auto-expire blacklist after BLACKLIST_DURATION_MS', () => {
            sm._blacklist('peer1')
            expect(sm.isBlacklisted('peer1')).toBe(true)

            jest.advanceTimersByTime(600_001)
            expect(sm.isBlacklisted('peer1')).toBe(false)
        })

        it('should overwrite existing blacklist timer on re-blacklist', () => {
            sm._blacklist('peer1')
            // Re-blacklist resets the timer
            sm._blacklist('peer1')
            // Only one timer should be active (previous was cleared)
            expect(sm.blacklistTimeouts.size).toBe(1)
        })
    })

    // ─── Strike system ─────────────────────────────────────────────────────────

    describe('Strike system', () => {
        it('should accumulate strikes without blacklisting at 1-2', () => {
            expect(sm.addStrike('p')).toBe(false)
            expect(sm.addStrike('p')).toBe(false)
            expect(sm.isBlacklisted('p')).toBe(false)
        })

        it('should blacklist after 3 strikes', () => {
            sm.addStrike('p')
            sm.addStrike('p')
            const result = sm.addStrike('p')
            expect(result).toBe(true)
            expect(sm.isBlacklisted('p')).toBe(true)
        })

        it('penalize(isMalicious=false) should NOT add strike', () => {
            const blocked = sm.penalize('p', false)
            expect(blocked).toBe(false)
            expect(sm.strikes.get('p')).toBeUndefined()
        })

        it('penalize(isMalicious=true) should add strike', () => {
            sm.penalize('p', true)
            expect(sm.strikes.get('p')).toBe(1)
        })
    })

    // ─── Circuit Breaker ───────────────────────────────────────────────────────

    describe('Circuit Breaker', () => {
        it('should not trigger before 5 attacks', () => {
            const onPanic = jest.fn()
            const onResume = jest.fn()
            for (let i = 0; i < 4; i++) sm.triggerCircuitBreaker(onPanic, onResume)
            expect(onPanic).not.toHaveBeenCalled()
        })

        it('should trigger panic on 5th attack', () => {
            const onPanic = jest.fn()
            const onResume = jest.fn()
            for (let i = 0; i < 5; i++) sm.triggerCircuitBreaker(onPanic, onResume)
            expect(onPanic).toHaveBeenCalledTimes(1)
            expect(sm.panicMode).toBe(true)
        })

        it('should resume after 5 minutes', () => {
            const onPanic = jest.fn()
            const onResume = jest.fn()
            for (let i = 0; i < 5; i++) sm.triggerCircuitBreaker(onPanic, onResume)

            jest.advanceTimersByTime(300_001)
            expect(onResume).toHaveBeenCalledTimes(1)
            expect(sm.panicMode).toBe(false)
            expect(sm.attackCounter).toBe(0)
        })

        it('should not trigger twice in panic mode', () => {
            const onPanic = jest.fn()
            const onResume = jest.fn()
            for (let i = 0; i < 10; i++) sm.triggerCircuitBreaker(onPanic, onResume)
            expect(onPanic).toHaveBeenCalledTimes(1)
        })
    })

    // ─── UsageTracker integration ──────────────────────────────────────────────

    describe('UsageTracker', () => {
        it('should expose usageTracker', () => {
            expect(sm.usageTracker).toBeDefined()
            expect(typeof sm.usageTracker.getCredits).toBe('function')
        })

        it('should start new peers at 2500 MB (50% of 5000)', () => {
            expect(sm.usageTracker.getCredits('new-ip')).toBe(2500)
        })

        it('reserve should deduct credits', () => {
            const ok = sm.usageTracker.reserve('ip', 1000)
            expect(ok).toBe(true)
            expect(sm.usageTracker.getCredits('ip')).toBeCloseTo(1500, 0)
        })

        it('reserve should fail when insufficient credits', () => {
            sm.usageTracker.consume('ip', 2400) // leaves 100
            const ok = sm.usageTracker.reserve('ip', 200)
            expect(ok).toBe(false)
        })

        it('refund should return credits', () => {
            sm.usageTracker.reserve('ip', 500)
            sm.usageTracker.refund('ip', 300)
            expect(sm.usageTracker.getCredits('ip')).toBeCloseTo(2300, 0)
        })
    })

    // ─── Periodic cleanup ──────────────────────────────────────────────────────

    describe('Periodic cleanup', () => {
        it('start() should start cleanup interval', () => {
            expect(sm._cleanupInterval).toBeNull()
            sm.start(60_000)
            expect(sm._cleanupInterval).not.toBeNull()
        })

        it('destroy() should clear cleanup interval', () => {
            sm.start(60_000)
            sm.destroy()
            expect(sm._cleanupInterval).toBeNull()
        })
    })
})
