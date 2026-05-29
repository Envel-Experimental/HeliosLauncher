'use strict'

/**
 * Regression tests for bugs identified in code review:
 *
 * 1. cleanup() amnesia: previously evicted ANY idle peer, allowing IP-rotation exploit
 *    where attackers get 2.5 GB credit reset every 2 hours.
 *    FIX: only evict entries where credits >= MAX_CREDITS_PER_IP (fully regenerated).
 *
 * 2. LRU eviction order correctness (existing).
 *
 * 3. Token operations correctness (existing, extended).
 */
describe('UsageTracker', () => {
    let UsageTracker
    const MAX = 5000

    beforeEach(() => {
        jest.resetModules()
        jest.doMock('@network/constants', () => ({
            MAX_CREDITS_PER_IP: MAX,
            CREDIT_REGEN_RATE: 0.5
        }))
        UsageTracker = require('../../../network/UsageTracker')
    })

    // ─── Basic token ops ──────────────────────────────────────────────────────

    it('initializes new peers at 50% (2500 MB)', () => {
        const t = new UsageTracker()
        expect(t.getCredits('ip')).toBe(2500)
    })

    it('applies time-based regen on subsequent getCredits calls', () => {
        const t = new UsageTracker()
        t.consume('ip', 500) // 2500 - 500 = 2000
        const entry = t.data.get('ip')
        entry.lastUpdate -= 10_000 // 10 s ago
        // 2000 + (10 * 0.5) = 2005
        expect(t.getCredits('ip')).toBeCloseTo(2005, 0)
    })

    it('regen never exceeds MAX_CREDITS_PER_IP', () => {
        const t = new UsageTracker()
        t.data.set('ip', { credits: MAX - 1, lastUpdate: Date.now() - 9_999_999 })
        expect(t.getCredits('ip')).toBe(MAX)
    })

    it('reserve deducts credits and returns true', () => {
        const t = new UsageTracker()
        expect(t.reserve('ip', 1000)).toBe(true)
        expect(t.getCredits('ip')).toBeCloseTo(1500, 0)
    })

    it('reserve returns false when insufficient credits', () => {
        const t = new UsageTracker()
        t.consume('ip', 2400) // 100 remaining
        expect(t.reserve('ip', 200)).toBe(false)
        // credits unchanged
        expect(t.getCredits('ip')).toBeCloseTo(100, 0)
    })

    it('refund restores credits capped at MAX', () => {
        const t = new UsageTracker()
        t.consume('ip', 100)   // 2400
        t.refund('ip', 9999)   // capped
        expect(t.getCredits('ip')).toBe(MAX)
    })

    it('refund on unknown key is a no-op', () => {
        const t = new UsageTracker()
        expect(() => t.refund('ghost', 100)).not.toThrow()
        expect(t.data.has('ghost')).toBe(false)
    })

    it('consume floors at 0 (no negative balance)', () => {
        const t = new UsageTracker()
        t.consume('ip', 999999)
        expect(t.getCredits('ip')).toBe(0)
    })

    it('consume ignores non-numeric amountMB', () => {
        const t = new UsageTracker()
        const before = t.getCredits('ip')
        t.consume('ip', NaN)
        t.consume('ip', null)
        t.consume('ip', undefined)
        expect(t.getCredits('ip')).toBeCloseTo(before, 0)
    })

    // ─── cleanup() amnesia regression ─────────────────────────────────────────

    it('cleanup() does NOT evict idle peers with drained credits (exploit prevention)', () => {
        // Regression: old code deleted ANY entry older than 2h, allowing an
        // attacker to rotate IPs every 2h and get 2.5 GB credit reset each time.
        const t = new UsageTracker()

        // Peer spent most of its credits (malicious over-downloader)
        t.data.set('drained-ip', {
            credits: 100, // 100 MB left, far below MAX
            lastUpdate: Date.now() - 7_200_001 // idle > 2h
        })

        t.cleanup()

        // MUST still be present — if evicted, attacker gets fresh 2.5 GB on reconnect
        expect(t.data.has('drained-ip')).toBe(true)
        expect(t.data.get('drained-ip').credits).toBe(100)
    })

    it('cleanup() DOES evict idle peers whose balance is fully capped', () => {
        const t = new UsageTracker()

        // Peer is fully regenerated — safe to evict (will get MAX*0.5 on re-entry, same as now)
        t.data.set('full-ip', {
            credits: MAX, // fully capped
            lastUpdate: Date.now() - 7_200_001 // idle > 2h
        })

        t.cleanup()

        // OK to evict — no credit advantage lost
        expect(t.data.has('full-ip')).toBe(false)
    })

    it('cleanup() does NOT evict recently-active peers regardless of credit level', () => {
        const t = new UsageTracker()

        // Active peer with full credits (too recent to evict)
        t.data.set('active-full-ip', {
            credits: MAX,
            lastUpdate: Date.now() - 3_600_000 // only 1h ago
        })

        t.cleanup()
        expect(t.data.has('active-full-ip')).toBe(true)
    })

    it('cleanup() eviction does not create IP-rotation exploit scenario', () => {
        // Simulate an attacker who has drained credits and then goes idle for 2h.
        // They should NOT get a free 2.5 GB reset after cleanup + reconnect.
        const t = new UsageTracker()

        const attacker = 'attacker-ip'
        t.data.set(attacker, {
            credits: 50,  // nearly drained
            lastUpdate: Date.now() - 7_200_001
        })

        t.cleanup()

        // Entry still exists with the drained balance — no free reset
        expect(t.data.has(attacker)).toBe(true)
        expect(t.data.get(attacker).credits).toBe(50)
    })

    // ─── LRU eviction ─────────────────────────────────────────────────────────

    it('evicts oldest entry when map exceeds 5000', () => {
        const t = new UsageTracker()
        for (let i = 0; i < 5000; i++) {
            t.data.set(`ip-${i}`, { credits: 2500, lastUpdate: i + 1 })
        }
        t.getCredits('new-ip')
        expect(t.data.has('ip-0')).toBe(false)
        expect(t.data.size).toBe(5000)
    })

    // ─── Map insertion-order refresh (LRU correctness) ────────────────────────

    it('getCredits refreshes insertion order for correct LRU eviction', () => {
        const t = new UsageTracker()
        // Insert two entries, ip-A first (oldest)
        t.data.set('ip-A', { credits: 2500, lastUpdate: 1 })
        t.data.set('ip-B', { credits: 2500, lastUpdate: 2 })

        // Access ip-A — should move it to end (most recent)
        t.getCredits('ip-A')

        // Now fill to 5000
        for (let i = 0; i < 4998; i++) {
            t.data.set(`extra-${i}`, { credits: 2500, lastUpdate: Date.now() })
        }
        // ip-B is now the oldest and should be evicted next
        t.getCredits('fresh')

        expect(t.data.has('ip-A')).toBe(true) // was refreshed, not evicted
        expect(t.data.has('ip-B')).toBe(false)
    })
})
