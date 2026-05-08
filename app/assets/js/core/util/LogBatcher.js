/**
 * Enterprise-grade Log Batcher.
 * Throttles high-frequency log streams into controllable IPC-friendly chunks.
 */
class LogBatcher {
    /**
     * @param {Function} onFlush Callback triggered with combined log data.
     * @param {number} interval Throttling interval in ms.
     * @param {number} maxBufferSize Maximum chunk size in characters (safety cap).
     */
    constructor(onFlush, interval = 150, maxBufferSize = 256000) {
        this.onFlush = onFlush
        this.interval = interval
        this.maxBufferSize = maxBufferSize
        this.buffer = []
        this.bufferSize = 0
        this.timer = null
    }

    /**
     * Queue log data for batching.
     * @param {string|Buffer} data
     */
    enqueue(data) {
        const str = data.toString()
        this.buffer.push(str)
        this.bufferSize += str.length

        // Force flush if buffer grows too large
        if (this.bufferSize >= this.maxBufferSize) {
            this.flush()
        } else if (!this.timer) {
            this.timer = setTimeout(() => this.flush(), this.interval)
        }
    }

    /**
     * Synchronously flush the current buffer.
     */
    flush() {
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }

        if (this.buffer.length > 0) {
            let combined = this.buffer.join('')
            // Apply hard cap if needed
            if (combined.length > this.maxBufferSize) {
                combined = combined.substring(combined.length - this.maxBufferSize)
            }
            this.onFlush(combined)
            this.buffer = []
            this.bufferSize = 0
        }
    }

    /**
     * Destroy the batcher and cancel any pending flushes.
     */
    destroy() {
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }
        this.buffer = []
        this.bufferSize = 0
    }
}

module.exports = { LogBatcher }
