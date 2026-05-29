// @ts-check
'use strict'

const { Transform } = require('stream')

/**
 * Token-bucket global rate limiter with per-stream independent backpressure.
 *
 * Architecture:
 *   • A singleton token bucket refills at `limit` bytes/sec every 100 ms.
 *   • Each call to `throttle()` returns an independent Transform stream.
 *   • When tokens are available, the transform immediately calls callback()
 *     (allowing the upstream fs.createReadStream to read the next chunk).
 *   • When tokens are exhausted, the transform registers itself in `_waiters`
 *     (NOT a shared FIFO queue — each stream gets its own slot).
 *     On next refill, waiters are served in round-robin fair-share order.
 *   • If the downstream socket is full (push() returns false), backpressure
 *     is applied independently per-stream via Transform's built-in _read().
 *   • On stream destroy, the waiter is removed from the global list so no
 *     memory leaks or ghost callbacks remain.
 *
 * Key invariant: streams with slow downstream sockets do NOT block token
 * allocation for other streams. Each stream is independent.
 */
class RateLimiter {
    constructor() {
        /** @type {number} Bytes per second. 0 = unlimited. */
        this.limit = 0

        /** @type {number} Available tokens in the bucket. */
        this.tokens = 0

        /** @type {number} Timestamp of last refill. */
        this.lastCheck = Date.now()

        /**
         * List of streams waiting for tokens.
         * Each entry holds the stream reference and a thunk to call when tokens arrive.
         * @type {Array<{ stream: Transform, size: number, run: () => void }>}
         */
        this._waiters = []

        /** @type {ReturnType<typeof setInterval> | null} */
        this.interval = null
    }

    // ─── Public API ────────────────────────────────────────────────────────────

    /**
     * @param {number} bytesPerSecond  0 = unlimited
     */
    setLimit(bytesPerSecond) {
        this.limit = Math.max(0, bytesPerSecond)
        if (this.limit > 0) {
            this.tokens = this.limit // Fill to cap on (re-)configure
            this._startRefill()
        } else {
            this._stopRefill()
            this._flushWaiters() // Release all pending streams immediately
        }
    }

    /**
     * Returns a new independent Transform stream that throttles through this limiter.
     * Call once per upload stream — do NOT reuse the returned Transform.
     * @returns {Transform}
     */
    throttle() {
        const limiter = this

        const stream = new Transform({
            // 64 KB high-water mark matches typical TCP segment size.
            // Keeps the Node.js internal buffer tight so backpressure propagates fast.
            highWaterMark: 64 * 1024,

            transform(chunk, _enc, callback) {
                if (limiter.limit === 0) {
                    // No rate limiting — pass through immediately, respecting downstream backpressure
                    if (!this.push(chunk)) {
                        // Downstream full: wait for _read() before signalling upstream we're ready
                        this._pendingCallback = callback
                    } else {
                        callback()
                    }
                    return
                }

                // Attempt to consume tokens right now (fast path for bursts)
                if (limiter.tokens >= chunk.length) {
                    limiter.tokens -= chunk.length
                    if (!this.push(chunk)) {
                        this._pendingCallback = callback
                    } else {
                        callback()
                    }
                    return
                }

                // Not enough tokens: register as a waiter.
                // The waiter will be called from _drainWaiters() when tokens refill.
                limiter._waiters.push({
                    stream: this,
                    size: chunk.length,
                    run: () => {
                        if (!this.push(chunk)) {
                            this._pendingCallback = callback
                        } else {
                            callback()
                        }
                    }
                })
            },

            // _read() is called by Node.js internals when the downstream consumer
            // is ready for more data (i.e. the socket drained). Resume the upstream
            // fs.createReadStream by calling the deferred callback.
            read(_size) {
                if (this._pendingCallback) {
                    const cb = this._pendingCallback
                    this._pendingCallback = null
                    cb()
                }
            },

            destroy(err, callback) {
                // Remove this stream from the global waiter list to prevent ghost callbacks
                limiter._waiters = limiter._waiters.filter(w => w.stream !== this)
                if (this._pendingCallback) {
                    const cb = this._pendingCallback
                    this._pendingCallback = null
                    cb() // Release upstream so it can clean itself up
                }
                callback(err)
            }
        })

        stream._pendingCallback = null
        return stream
    }

    /**
     * Update the rate limit. Called by BandwidthManager on each AIMD step.
     * @param {number}  limitBytes   Bytes/sec. 0 = unlimited.
     * @param {boolean} enabled      If false, sets limit to 1 B/s (effectively paused).
     */
    update(limitBytes, enabled) {
        if (!enabled) {
            // The engine should stop accepting new uploads when disabled.
            // We still apply a non-zero floor so existing transfers can drain gracefully.
            this.setLimit(1)
            return
        }
        this.setLimit(limitBytes)
    }

    // ─── Private ───────────────────────────────────────────────────────────────

    _startRefill() {
        if (this.interval) clearInterval(this.interval)
        this.lastCheck = Date.now()
        this.interval = setInterval(() => this._refill(), 100)
        if (this.interval && this.interval.unref) this.interval.unref()
    }

    _stopRefill() {
        if (this.interval) {
            clearInterval(this.interval)
            this.interval = null
        }
    }

    _refill() {
        if (this.limit === 0) return

        const now = Date.now()
        const elapsed = (now - this.lastCheck) / 1000
        this.lastCheck = now

        // Cap at one second of tokens to prevent burst storms after a pause
        this.tokens = Math.min(this.limit, this.tokens + this.limit * elapsed)

        this._drainWaiters()
    }

    /**
     * Serve waiters in round-robin fair-share order.
     * Skips streams whose sockets are already full (_pendingCallback set) —
     * those streams will pick up tokens on their next _read() → callback chain.
     */
    _drainWaiters() {
        if (this._waiters.length === 0 || this.tokens <= 0) return

        // Single pass — avoid infinite loops if a waiter sets _pendingCallback
        const snapshot = this._waiters.splice(0)
        const deferred = []

        for (const waiter of snapshot) {
            if (waiter.stream.destroyed) continue // cleaned up, skip
            if (waiter.stream._pendingCallback) {
                // Stream's downstream is still full; re-queue without consuming tokens
                deferred.push(waiter)
                continue
            }
            if (this.tokens >= waiter.size) {
                this.tokens -= waiter.size
                waiter.run()
            } else {
                // Not enough tokens yet; put back for next refill
                deferred.push(waiter)
            }
        }

        this._waiters = deferred
    }

    /**
     * Flush all waiters immediately (called when limit drops to 0).
     */
    _flushWaiters() {
        const snapshot = this._waiters.splice(0)
        for (const waiter of snapshot) {
            if (!waiter.stream.destroyed) waiter.run()
        }
    }
}

module.exports = new RateLimiter()
