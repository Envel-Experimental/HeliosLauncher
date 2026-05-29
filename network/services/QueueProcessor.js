// @ts-check
'use strict'

const isDev = require('../../app/assets/js/core/isdev')
const { MAX_SERVER_QUEUE_SIZE } = require('../constants')

/**
 * QueueProcessor — manages the server-side upload queue.
 *
 * Responsibilities:
 *   • Enqueue incoming peer requests (with DoS cap).
 *   • Drain the queue when upload slots become available (adaptive).
 *   • Prune requests from disconnected peers.
 *   • Reject stale requests (> 30 s).
 */
class QueueProcessor {
    /**
     * @param {{ activeUploads: number, adaptiveSlotCount: number }} counters
     *   Reference to the shared mutable counters in P2PEngine (avoid copying).
     */
    constructor(counters) {
        this._counters = counters

        /** @type {Array<{ peer: any, reqId: number, hash: string, relPath: string|null, fileId: string|null, startOffset: number, timestamp: number }>} */
        this._queue = []
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    destroy() {
        this._queue = []
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    enqueue(peer, reqId, hash, relPath, fileId, startOffset = 0) {
        // Mitigate Queue Starvation: Limit requests per peer
        const peerActiveCount = this._queue.filter(r => r.peer === peer).length
        const MAX_PEER_QUEUE_LIMIT = 32
        if (peerActiveCount >= MAX_PEER_QUEUE_LIMIT) {
            peer.sendError(reqId, 'Queue Limit Exceeded')
            return
        }

        if (this._queue.length >= MAX_SERVER_QUEUE_SIZE) {
            peer.sendError(reqId, 'Server Busy (Queue Full)')
            return
        }

        this._queue.push({ peer, reqId, hash, relPath, fileId, startOffset, timestamp: Date.now() })
        this._drain()
    }

    /**
     * Called when an upload finishes so the next queued request can start.
     */
    onUploadFinished() {
        this._drain()
    }

    /**
     * Remove all pending requests for `peer` (called on disconnect).
     * @param {any} peer
     */
    pruneForPeer(peer) {
        const before = this._queue.length
        this._queue = this._queue.filter(r => r.peer !== peer)
        if (isDev && this._queue.length < before) {
            // console.debug(`[QueueProcessor] Pruned ${before - this._queue.length} zombie requests`)
        }
    }

    /** @returns {number} */
    get size() {
        return this._queue.length
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _drain() {
        const max = this._counters.adaptiveSlotCount
        const STALE_MS = 30_000

        while (this._counters.activeUploads < max && this._queue.length > 0) {
            const req = this._queue.shift()

            // Sanity guards
            if (!req) break
            if (req.peer.socket.destroyed) continue
            if (Date.now() - req.timestamp > STALE_MS) {
                if (isDev) console.warn(`[QueueProcessor] Dropping stale request ${req.reqId}`)
                try {
                    req.peer.sendError(req.reqId, 'Timed out in server queue')
                } catch (_) {}
                continue
            }

            req.peer.executeRequest(req.reqId, req.hash, req.relPath, req.fileId, req.startOffset)
        }
    }
}

module.exports = QueueProcessor
