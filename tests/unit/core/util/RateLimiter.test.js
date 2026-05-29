'use strict'

const { PassThrough } = require('stream')

let RateLimiter

describe('RateLimiter', () => {

    beforeEach(() => {
        jest.resetModules()
        RateLimiter = require('../../../../app/assets/js/core/util/RateLimiter')
        RateLimiter.setLimit(0) // Reset to unlimited
        RateLimiter._waiters = []
    })

    afterEach(() => {
        RateLimiter.setLimit(0)
        RateLimiter._stopRefill()
        RateLimiter._waiters = []
    })

    // ─── Basic API ────────────────────────────────────────────────────────────

    it('should set limit and start refill interval', () => {
        RateLimiter.setLimit(1000)
        expect(RateLimiter.limit).toBe(1000)
        expect(RateLimiter.interval).not.toBeNull()
    })

    it('should refill tokens over time', async () => {
        RateLimiter.setLimit(1000)
        RateLimiter.tokens = 0
        RateLimiter.lastCheck = Date.now()

        await new Promise(resolve => setTimeout(resolve, 200))
        RateLimiter._refill()

        expect(RateLimiter.tokens).toBeGreaterThan(0)
        expect(RateLimiter.tokens).toBeLessThanOrEqual(1000)
    })

    it('should stop refill interval when limit set to 0', () => {
        RateLimiter.setLimit(1000)
        RateLimiter.setLimit(0)
        expect(RateLimiter.interval).toBeNull()
    })

    it('update() with enabled=true sets the limit', () => {
        RateLimiter.update(5000, true)
        expect(RateLimiter.limit).toBe(5000)
    })

    it('update() with enabled=false sets limit to 1 (graceful choke)', () => {
        RateLimiter.update(0, false)
        expect(RateLimiter.limit).toBe(1)
    })

    // ─── throttle() stream ────────────────────────────────────────────────────

    it('throttle() passes data through immediately when no limit', done => {
        RateLimiter.setLimit(0)
        const t = RateLimiter.throttle()
        const chunks = []
        t.on('data', c => chunks.push(c))
        t.on('end', () => {
            expect(Buffer.concat(chunks).toString()).toBe('hello')
            done()
        })
        t.write(Buffer.from('hello'))
        t.end()
    })

    it('throttle() queues chunks as waiters when tokens exhausted', done => {
        RateLimiter.setLimit(20) // 20 bytes/s
        RateLimiter.tokens = 0   // Empty bucket

        const t = RateLimiter.throttle()
        const chunks = []
        t.on('data', c => chunks.push(c))

        t.write(Buffer.from('hello world')) // 11 bytes, no tokens

        // No data yet — should be parked as a waiter
        setImmediate(() => {
            expect(chunks.length).toBe(0)
            expect(RateLimiter._waiters.length).toBe(1)

            // Refill with enough tokens
            RateLimiter.tokens = 20
            RateLimiter._drainWaiters()

            setImmediate(() => {
                expect(chunks.length).toBe(1)
                expect(chunks[0].toString()).toBe('hello world')
                done()
            })
        })
    })

    it('throttle() removes waiter on stream destroy (no memory leak)', done => {
        RateLimiter.setLimit(20)
        RateLimiter.tokens = 0

        const t = RateLimiter.throttle()
        t.write(Buffer.from('hello world'))

        setImmediate(() => {
            expect(RateLimiter._waiters.length).toBe(1)
            t.destroy()
            setImmediate(() => {
                expect(RateLimiter._waiters.length).toBe(0)
                done()
            })
        })
    })

    it('fast streams are not blocked by slow streams (independent backpressure)', done => {
        RateLimiter.setLimit(10_000) // 10 KB/s — enough for both
        RateLimiter.tokens = 10_000

        const results = { a: [], b: [] }

        const tA = RateLimiter.throttle()
        const tB = RateLimiter.throttle()

        tA.on('data', c => results.a.push(c.toString()))
        tB.on('data', c => results.b.push(c.toString()))

        tA.write(Buffer.from('chunk-a'))
        tB.write(Buffer.from('chunk-b'))

        setImmediate(() => {
            // Both should have received their data
            expect(results.a.join('')).toContain('chunk-a')
            expect(results.b.join('')).toContain('chunk-b')
            done()
        })
    })

    it('_flushWaiters() releases all waiters when limit drops to 0', done => {
        RateLimiter.setLimit(100)
        RateLimiter.tokens = 0

        const t = RateLimiter.throttle()
        const chunks = []
        t.on('data', c => chunks.push(c))
        t.write(Buffer.from('test'))

        setImmediate(() => {
            expect(RateLimiter._waiters.length).toBe(1)
            RateLimiter.setLimit(0) // Triggers _flushWaiters
            setImmediate(() => {
                expect(chunks.length).toBe(1)
                expect(RateLimiter._waiters.length).toBe(0)
                done()
            })
        })
    })
})
