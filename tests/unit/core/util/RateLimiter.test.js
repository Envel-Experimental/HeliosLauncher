let RateLimiter

describe('RateLimiter', () => {
    
    beforeEach(() => {
        jest.resetModules()
        RateLimiter = require('../../../../app/assets/js/core/util/RateLimiter')
        RateLimiter.setLimit(0) // Reset to unlimited
        RateLimiter.queue = []
    })

    it('should set limit and start refill', () => {
        RateLimiter.setLimit(1000)
        expect(RateLimiter.limit).toBe(1000)
        expect(RateLimiter.interval).toBeDefined()
    })

    it('should refill tokens over time', async () => {
        RateLimiter.setLimit(1000)
        RateLimiter.tokens = 0
        RateLimiter.lastCheck = Date.now()

        await new Promise(resolve => setTimeout(resolve, 200))
        RateLimiter.refill()

        expect(RateLimiter.tokens).toBeGreaterThan(0)
        expect(RateLimiter.tokens).toBeLessThanOrEqual(1000)
    })

    it('should throttle stream chunks', async () => {
        RateLimiter.setLimit(20) // 20 bytes per second
        RateLimiter.tokens = 0 // No tokens initially

        const throttle = RateLimiter.throttle()
        const chunks = []
        
        throttle.on('data', (chunk) => {
            chunks.push(chunk)
        })

        const input = Buffer.from('hello world') // 11 bytes
        throttle.write(input)

        // Should be queued
        expect(chunks.length).toBe(0)
        expect(RateLimiter.queue.length).toBe(1)

        // Wait to refill tokens
        await new Promise(resolve => setTimeout(resolve, 1500))
        RateLimiter.refill()

        // Wait for stream events
        await new Promise(resolve => setTimeout(resolve, 200))

        expect(chunks.length).toBe(1)
        expect(chunks[0].toString()).toBe('hello world')
    })

    it('should handle update', () => {
        RateLimiter.update(5000, true)
        expect(RateLimiter.limit).toBe(5000)
    })

    it('should stop refill when limit is 0', () => {
        RateLimiter.setLimit(1000)
        RateLimiter.setLimit(0)
        expect(RateLimiter.interval).toBeNull()
    })
})
