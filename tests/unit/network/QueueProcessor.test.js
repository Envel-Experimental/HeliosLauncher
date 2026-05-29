'use strict'

describe('QueueProcessor', () => {
    let QueueProcessor
    let counters
    let qp

    beforeEach(() => {
        jest.resetModules()
        jest.useFakeTimers()

        jest.doMock('@network/constants', () => ({
            MAX_SERVER_QUEUE_SIZE: 10
        }))

        QueueProcessor = require('../../../network/services/QueueProcessor')
        counters = { activeUploads: 0, adaptiveSlotCount: 5 }
        qp = new QueueProcessor(counters)
    })

    afterEach(() => {
        qp.destroy()
        jest.useRealTimers()
    })

    // ─── Basic enqueue / drain ─────────────────────────────────────────────────

    const makePeer = (id = 'peer') => ({
        socket: { destroyed: false },
        getID: () => id,
        sendError: jest.fn(),
        executeRequest: jest.fn()
    })

    it('should immediately drain when slots are available', () => {
        const peer = makePeer()
        qp.enqueue(peer, 1, 'hash', null, null)
        expect(peer.executeRequest).toHaveBeenCalledWith(1, 'hash', null, null, 0)
    })

    it('should reject with sendError when queue is full', () => {
        // Fill 10 slots
        for (let i = 0; i < 10; i++) {
            counters.activeUploads = 10 // no drain
            const peer = makePeer()
            qp._queue.push({ peer, reqId: i, hash: 'h', relPath: null, fileId: null, startOffset: 0, timestamp: Date.now() })
        }
        const peer = makePeer()
        qp.enqueue(peer, 99, 'h', null, null)
        expect(peer.sendError).toHaveBeenCalledWith(99, 'Server Busy (Queue Full)')
    })

    it('should not execute request on destroyed socket', () => {
        counters.activeUploads = 3 // below adaptiveSlotCount=5
        const peer = makePeer()
        peer.socket.destroyed = true
        qp._queue.push({ peer, reqId: 1, hash: 'h', relPath: null, fileId: null, startOffset: 0, timestamp: Date.now() })
        qp.onUploadFinished()
        expect(peer.executeRequest).not.toHaveBeenCalled()
    })

    it('should skip and notify stale requests (older than 30s)', () => {
        const peer = makePeer()
        const oldTimestamp = Date.now() - 31_000
        qp._queue.push({ peer, reqId: 1, hash: 'h', relPath: null, fileId: null, startOffset: 0, timestamp: oldTimestamp })
        qp.onUploadFinished()
        expect(peer.executeRequest).not.toHaveBeenCalled()
        expect(peer.sendError).toHaveBeenCalledWith(1, 'Timed out in server queue')
    })

    it('should enforce per-peer queue limit of 32 requests', () => {
        const peer = makePeer('spam-peer')
        counters.activeUploads = 10 // block drain
        
        // Fill 32 slots for this peer
        for (let i = 0; i < 32; i++) {
            qp._queue.push({ peer, reqId: i, hash: 'h', relPath: null, fileId: null, startOffset: 0, timestamp: Date.now() })
        }
        
        // Try enqueuing a 33rd request
        qp.enqueue(peer, 99, 'h', null, null)
        expect(peer.sendError).toHaveBeenCalledWith(99, 'Queue Limit Exceeded')
        expect(qp.size).toBe(32)
    })

    // ─── Pruning ──────────────────────────────────────────────────────────────

    it('pruneForPeer should remove all requests for that peer', () => {
        const peer = makePeer('target')
        const other = makePeer('other')
        counters.activeUploads = counters.adaptiveSlotCount // block drain
        qp._queue.push({ peer, reqId: 1, hash: 'h', relPath: null, fileId: null, startOffset: 0, timestamp: Date.now() })
        qp._queue.push({ peer: other, reqId: 2, hash: 'h', relPath: null, fileId: null, startOffset: 0, timestamp: Date.now() })
        qp._queue.push({ peer, reqId: 3, hash: 'h', relPath: null, fileId: null, startOffset: 0, timestamp: Date.now() })

        qp.pruneForPeer(peer)
        expect(qp.size).toBe(1)
        expect(qp._queue[0].peer).toBe(other)
    })

    it('pruneForPeer on unknown peer should do nothing', () => {
        const peer = makePeer()
        qp._queue.push({ peer, reqId: 1, hash: 'h', relPath: null, fileId: null, startOffset: 0, timestamp: Date.now() })
        const stranger = makePeer('stranger')
        qp.pruneForPeer(stranger)
        expect(qp.size).toBe(1)
    })

    // ─── Adaptive slots ───────────────────────────────────────────────────────

    it('should respect adaptiveSlotCount from shared counters', () => {
        counters.adaptiveSlotCount = 2
        counters.activeUploads = 2 // slots full
        const peer = makePeer()
        qp._queue.push({ peer, reqId: 1, hash: 'h', relPath: null, fileId: null, startOffset: 0, timestamp: Date.now() })
        qp.onUploadFinished()
        expect(peer.executeRequest).not.toHaveBeenCalled()
    })

    // ─── Size getter ──────────────────────────────────────────────────────────

    it('size getter should reflect queue length', () => {
        const peer = makePeer()
        counters.activeUploads = counters.adaptiveSlotCount
        qp._queue.push({ peer, reqId: 1, hash: 'h', relPath: null, fileId: null, startOffset: 0, timestamp: Date.now() })
        expect(qp.size).toBe(1)
    })

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    it('destroy should clear the queue', () => {
        const peer = makePeer()
        qp._queue.push({ peer, reqId: 1, hash: 'h', relPath: null, fileId: null, startOffset: 0, timestamp: Date.now() })
        qp.destroy()
        expect(qp.size).toBe(0)
    })
})
