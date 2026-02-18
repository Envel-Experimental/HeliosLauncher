const { Transform } = require('stream');

class RateLimiter {
    constructor() {
        this.limit = 0; // Bytes per second. 0 = unlimited.
        this.active = true;
        this.tokens = 0;
        this.lastCheck = Date.now();
        this.queue = [];
        this.interval = null;
    }

    setLimit(bytesPerSecond) {
        this.limit = bytesPerSecond;
        if (this.limit > 0) {
            this.tokens = this.limit; // Start full
            this.startRefill();
        } else {
            this.stopRefill();
            this.processQueue(); // Release everyone
        }
    }

    startRefill() {
        if (this.interval) clearInterval(this.interval);
        this.lastCheck = Date.now();
        this.interval = setInterval(() => {
            this.refill();
        }, 100); // 100ms interval
    }

    stopRefill() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    refill() {
        const now = Date.now();
        const elapsed = (now - this.lastCheck) / 1000;
        this.lastCheck = now;

        if (this.limit > 0) {
            const newTokens = this.limit * elapsed;
            this.tokens = Math.min(this.limit, this.tokens + newTokens);
            this.processQueue();
        }
    }

    processQueue() {
        while (this.queue.length > 0) {
            const next = this.queue[0];
            if (this.limit === 0 || this.tokens >= next.size) {
                if (this.limit > 0) {
                    this.tokens -= next.size;
                }
                next.callback();
                this.queue.shift();
            } else {
                break; // Not enough tokens for next item
            }
        }
    }

    throttle() {
        const limiter = this;
        return new Transform({
            transform(chunk, encoding, callback) {
                if (limiter.limit === 0) {
                    this.push(chunk);
                    callback();
                    return;
                }

                limiter.queue.push({
                    size: chunk.length,
                    callback: () => {
                        this.push(chunk);
                        callback();
                    }
                });
                limiter.processQueue();
            }
        });
    }

    /**
     * Updates operation mode.
     * @param {number} limitBytes Global limit in B/s.
     * @param {boolean} enabled Whether uploads are enabled.
     */
    update(limitBytes, enabled) {
        if (!enabled) {
            this.limit = 1; // Effectively stop (very slow) or handle logic elsewhere?
            // If disabled, P2P engines should probably stop accepting requests.
            // But if they are active, we can choke them or let them finish.
            // Let's set limit to 0 (unlimited) here? No.
            // We'll rely on Consumer to check 'enabled'.
            // Here we just handle rate.
        }
        this.setLimit(limitBytes);
    }
}

module.exports = new RateLimiter();
