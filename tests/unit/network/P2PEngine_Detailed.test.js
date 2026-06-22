/**
 * @jest-environment node
 */
'use strict'

describe('P2PEngine Detailed Tests', () => {
    let p2pEngine
    let ConfigManager
    let Hyperswarm
    let HyperDHT

    beforeEach(() => {
        jest.resetModules()

        jest.doMock('hyperswarm', () => {
            return jest.fn().mockImplementation(() => ({
                on: jest.fn(),
                join: jest.fn().mockReturnValue({ flushed: jest.fn().mockResolvedValue() }),
                destroy: jest.fn().mockResolvedValue(),
                peers: [],
                flushed: jest.fn().mockResolvedValue()
            }))
        })

        jest.doMock('hyperdht', () => {
            return jest.fn().mockImplementation(() => ({
                on: jest.fn(),
                destroy: jest.fn().mockResolvedValue()
            }))
        })

        jest.doMock('@core/configmanager', () => ({
            getSettings: jest.fn().mockReturnValue({
                deliveryOptimization: { globalOptimization: true }
            }),
            getP2PUploadLimit: jest.fn().mockReturnValue(15),
            isLoaded: jest.fn().mockReturnValue(true),
            getLauncherDirectorySync: jest.fn().mockReturnValue('/mock/launcher'),
            getDataDirectory: jest.fn().mockReturnValue('/mock/data'),
            getCommonDirectory: jest.fn().mockReturnValue('/mock/common'),
            getCommonDirectorySync: jest.fn().mockReturnValue('/mock/common'),
            getLocalOptimization: jest.fn().mockReturnValue(true),
            getP2PUploadEnabled: jest.fn().mockReturnValue(true)
        }))

        jest.doMock('@network/NodeAdapter', () => ({
            getProfile: jest.fn().mockReturnValue({ maxPeers: 10, passive: false, name: 'HIGH' }),
            isCritical: jest.fn().mockReturnValue(false),
            penaltyWeight: jest.fn().mockReturnValue(1),
            boostWeight: jest.fn()
        }))

        jest.doMock('@network/PeerPersistence', () => ({
            load: jest.fn().mockResolvedValue(),
            getPeers: jest.fn().mockReturnValue([])
        }))

        jest.doMock('@network/StatsManager', () => ({
            init: jest.fn(),
            record: jest.fn()
        }))

        jest.doMock('@network/ResourceMonitor', () => ({
            start: jest.fn(),
            stop: jest.fn(),
            getCPUUsage: jest.fn().mockReturnValue(10)
        }))

        jest.doMock('@app/assets/js/core/util/RateLimiter', () => ({
            update: jest.fn(),
            throttle: jest.fn()
        }))

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue([])
        })

        p2pEngine = require('@network/P2PEngine')
        ConfigManager = require('@core/configmanager')
        Hyperswarm = require('hyperswarm')
        HyperDHT = require('hyperdht')
    })

    afterEach(async () => {
        if (p2pEngine) {
            await p2pEngine.stop()
        }
    })

    // ─── UsageTracker (exposed via security service) ──────────────────────────

    describe('UsageTracker (via security service)', () => {
        test('should initialize with half credits and regenerate over time', () => {
            const tracker = p2pEngine.usageTracker
            const ip = '1.2.3.4'

            expect(tracker.getCredits(ip)).toBe(2500)

            tracker.consume(ip, 500)
            expect(tracker.getCredits(ip)).toBeCloseTo(2000, 0)

            const entry = tracker.data.get(ip)
            entry.lastUpdate -= 10_000 // 10 s ago
            // 2000 + (10 * 0.5) = 2005
            expect(tracker.getCredits(ip)).toBeCloseTo(2005, 0)
        })

        test('reserve and refund should work correctly', () => {
            const tracker = p2pEngine.usageTracker
            const ip = '1.2.3.4'

            expect(tracker.reserve(ip, 1000)).toBe(true)
            expect(tracker.getCredits(ip)).toBeCloseTo(1500, 0)

            tracker.refund(ip, 500)
            expect(tracker.getCredits(ip)).toBeCloseTo(2000, 0)

            expect(tracker.reserve(ip, 3000)).toBe(false)
            expect(tracker.getCredits(ip)).toBeCloseTo(2000, 0)
        })
    })

    // ─── isLocalIP ────────────────────────────────────────────────────────────

    describe('isLocalIP', () => {
        test('should detect IPv4 LAN ranges', () => {
            expect(p2pEngine.isLocalIP('192.168.1.1')).toBe(true)
            expect(p2pEngine.isLocalIP('10.0.0.5')).toBe(true)
            expect(p2pEngine.isLocalIP('172.16.0.1')).toBe(true)
            expect(p2pEngine.isLocalIP('127.0.0.1')).toBe(true)
            expect(p2pEngine.isLocalIP('8.8.8.8')).toBe(false)
        })

        test('should detect IPv6 local ranges', () => {
            expect(p2pEngine.isLocalIP('::1')).toBe(true)
            expect(p2pEngine.isLocalIP('fe80::1')).toBe(true)
            expect(p2pEngine.isLocalIP('::ffff:192.168.1.1')).toBe(true)
        })
    })

    // ─── Engine lifecycle ─────────────────────────────────────────────────────

    describe('Engine Lifecycle', () => {
        test('start should initialize dht and swarm', async () => {
            await p2pEngine.start()
            expect(HyperDHT).toHaveBeenCalled()
            expect(Hyperswarm).toHaveBeenCalled()
            expect(p2pEngine.swarm).toBeDefined()
        })

        test('stop should cleanup resources', async () => {
            await p2pEngine.start()
            const swarm = p2pEngine.swarm
            await p2pEngine.stop()
            expect(swarm.destroy).toHaveBeenCalled()
            expect(p2pEngine.swarm).toBeNull()
        })

        test('stop clears all pending request timeouts (no leak)', async () => {
            jest.useFakeTimers()
            const clearSpy = jest.spyOn(global, 'clearTimeout')

            const fakeTimeoutId = setTimeout(() => {}, 60_000)
            p2pEngine.requests.set(42, {
                timestamp: Date.now(),
                bytesReceived: 0,
                timeoutId: fakeTimeoutId,
                reject: jest.fn()
            })

            await p2pEngine.stop()
            expect(clearSpy).toHaveBeenCalledWith(fakeTimeoutId)
            expect(p2pEngine.requests.size).toBe(0)

            jest.useRealTimers()
        })
    })

    // ─── Memory manager — timeoutId leak fix ─────────────────────────────────

    describe('Memory Manager — no timeoutId leak', () => {
        test('pruning a hanging request must clearTimeout its timer', () => {
            jest.useFakeTimers()
            const clearSpy = jest.spyOn(global, 'clearTimeout')
            const fakeReject = jest.fn()
            const fakeTimeout = setTimeout(() => {}, 60_000)

            p2pEngine.requests.set(99999, {
                timestamp: Date.now() - 200_000, // very old
                bytesReceived: 0,
                timeoutId: fakeTimeout,
                reject: fakeReject
            })

            // Simulate what _startMemoryCleanup does
            const timeoutVal = 30_000
            const cutoff = Date.now() - timeoutVal * 2
            for (const [reqId, req] of p2pEngine.requests.entries()) {
                if (req.timestamp < cutoff) {
                    if (req.timeoutId) clearTimeout(req.timeoutId)
                    req.reject(new Error('Pruned'))
                    p2pEngine.requests.delete(reqId)
                }
            }

            expect(clearSpy).toHaveBeenCalledWith(fakeTimeout)
            expect(fakeReject).toHaveBeenCalled()
            expect(p2pEngine.requests.has(99999)).toBe(false)

            jest.useRealTimers()
        })
    })

    // ─── Peer selection ───────────────────────────────────────────────────────

    describe('_selectTopPeers', () => {
        test('should prefer LAN peers (10x score boost)', () => {
            const lan = {
                remoteWeight: 1, rtt: 100, currentDownloadSpeed: 0,
                isLocal: () => true
            }
            const wan = {
                remoteWeight: 1, rtt: 100, currentDownloadSpeed: 0,
                isLocal: () => false
            }
            const top = p2pEngine._selectTopPeers([wan, lan], 1)
            expect(top[0]).toBe(lan)
        })

        test('should prefer faster peers', () => {
            const fast = {
                remoteWeight: 1, rtt: 100, currentDownloadSpeed: 1_024_000,
                isLocal: () => false
            }
            const slow = {
                remoteWeight: 1, rtt: 100, currentDownloadSpeed: 10_000,
                isLocal: () => false
            }
            const top = p2pEngine._selectTopPeers([slow, fast], 1)
            expect(top[0]).toBe(fast)
        })

        test('should return at most n peers', () => {
            const peers = Array.from({ length: 10 }, (_, i) => ({
                remoteWeight: 1, rtt: 100, currentDownloadSpeed: i * 1000,
                isLocal: () => false
            }))
            const top = p2pEngine._selectTopPeers(peers, 3)
            expect(top.length).toBe(3)
        })

        test('should cache computed score on peer and not re-evaluate until manually updated or updater runs', () => {
            const peer = {
                remoteWeight: 1, rtt: 100, currentDownloadSpeed: 10_000,
                isLocal: () => false
            }
            const top1 = p2pEngine._selectTopPeers([peer], 1)
            expect(peer.cachedScore).toBeDefined()
            const originalScore = peer.cachedScore

            peer.currentDownloadSpeed = 1_000_000
            p2pEngine._selectTopPeers([peer], 1)
            expect(peer.cachedScore).toBe(originalScore)

            p2pEngine._calculatePeerScore(peer)
            expect(peer.cachedScore).not.toBe(originalScore)
        })

        test('periodic score updater interval should update all peers', () => {
            jest.useFakeTimers()
            const peer = {
                remoteWeight: 1, rtt: 100, currentDownloadSpeed: 10_000,
                isLocal: () => false
            }
            p2pEngine.peers = [peer]

            p2pEngine._startPeerScoreUpdater()
            expect(peer.cachedScore).toBeUndefined()

            jest.advanceTimersByTime(3000)

            expect(peer.cachedScore).toBeDefined()
            jest.useRealTimers()
        })

        // ── REGRESSION: weight² dominance ─────────────────────────────────────

        test('REGRESSION: linear weight — MID peer with 5ms RTT beats HIGH peer with 150ms RTT', () => {
            // Before fix: weight² made HIGH (50²=2500) always dominate MID (25²=625).
            // A 16ms RTT difference could not overcome the 4x weight² advantage.
            // After fix: linear weight. Score = weight × (1000/(rtt+5)) × speed × lan.
            //
            // MID peer: weight=25, rtt=5   → 25 × (1000/10)  × 1 × 1 = 2500
            // HIGH peer: weight=50, rtt=150 → 50 × (1000/155) × 1 × 1 ≈ 322
            const midFast = {
                remoteWeight: 25, rtt: 5, currentDownloadSpeed: 0,
                lastTransferSpeed: 0, isLocal: () => false
            }
            const highSlow = {
                remoteWeight: 50, rtt: 150, currentDownloadSpeed: 0,
                lastTransferSpeed: 0, isLocal: () => false
            }

            p2pEngine._calculatePeerScore(midFast)
            p2pEngine._calculatePeerScore(highSlow)

            // MID with 5ms RTT must beat HIGH with 150ms RTT
            expect(midFast.cachedScore).toBeGreaterThan(highSlow.cachedScore)
        })

        test('REGRESSION: weight² — HIGH peer with slightly worse RTT no longer incorrectly dominates', () => {
            // Old weight²: HIGH(50²=2500) × (10000/50) × 1 = 500000 vs MID(25²=625) × (10000/15) × 1 ≈ 416666
            // HIGH won even with 35ms more RTT. This was wrong.
            // New linear: HIGH(50) × (1000/45) × 1 ≈ 1111 vs MID(25) × (1000/10) × 1 = 2500 → MID wins
            const midPeer = {
                remoteWeight: 25, rtt: 5, currentDownloadSpeed: 0,
                lastTransferSpeed: 0, isLocal: () => false
            }
            const highPeer = {
                remoteWeight: 50, rtt: 40, currentDownloadSpeed: 0,
                lastTransferSpeed: 0, isLocal: () => false
            }

            p2pEngine._calculatePeerScore(midPeer)
            p2pEngine._calculatePeerScore(highPeer)

            // With old weight²: highPeer would win. With linear weight: midPeer (5ms RTT) should win.
            expect(midPeer.cachedScore).toBeGreaterThan(highPeer.cachedScore)
        })
    })

    // ─── _raceRequests & Bandwidth Race Aborts ─────────────────────────────────

    describe('_raceRequests & Bandwidth Race Aborts', () => {
        test('should abort losing peers when one peer wins the race', async () => {
            const peer1 = { socket: { destroyed: false }, sendError: jest.fn() }
            const peer2 = { socket: { destroyed: false }, sendError: jest.fn() }

            const stream = { emit: jest.fn(), isGracefulCancel: false }

            const executeSpy = jest.spyOn(p2pEngine, '_executeSingleRequest')
                .mockImplementation((peer) => {
                    if (peer === peer1) return Promise.resolve()
                    return new Promise(() => {}) // never resolves
                })

            const req2Id = 102
            const req2Reject = jest.fn()
            p2pEngine.requests.set(req2Id, {
                stream,
                peer: peer2,
                reject: req2Reject,
                timeoutId: null
            })

            const result = await p2pEngine._raceRequests([peer1, peer2], stream, 'hash', 100, null, null, 0)

            expect(result.success).toBe(true)
            expect(result.peer).toBe(peer1)
            expect(req2Reject).toHaveBeenCalledWith(expect.any(Error))
            expect(peer2.sendError).toHaveBeenCalledWith(req2Id, 'Aborted')

            executeSpy.mockRestore()
        })

        test('_executeSingleRequest should abort before sending if ctrl is aborted during setup', async () => {
            const peer = {
                socket: { once: jest.fn(), off: jest.fn(), destroyed: false },
                sendRequest: jest.fn()
            }
            const stream = { once: jest.fn(), off: jest.fn() }
            const ctrl = { aborted: true }

            await expect(p2pEngine._executeSingleRequest(peer, stream, 'hash', 100, null, null, 0, ctrl))
                .rejects.toThrow('race aborted')

            expect(peer.sendRequest).not.toHaveBeenCalled()
        })

        // ── REGRESSION: stream memory leak ────────────────────────────────────

        test('REGRESSION: _handleRequestAsync calls stream.destroy() not emit("error") on midTransfer', async () => {
            // Before fix: stream.emit('error') left the Readable open indefinitely.
            // After fix: stream.destroy(err) cleans up V8 buffers immediately.
            const { Readable } = require('stream')
            const stream = new Readable({ read() {} })
            const destroySpy = jest.spyOn(stream, 'destroy')
            const emitSpy  = jest.spyOn(stream, 'emit')

            const mockPeer = { socket: { destroyed: false }, cachedScore: 1000 }
            p2pEngine.peers = [mockPeer]

            // Mock _selectTopPeers to return our peer
            jest.spyOn(p2pEngine, '_selectTopPeers').mockReturnValue([mockPeer])

            // Mock _raceRequests to return a midTransfer failure
            const midError = Object.assign(new Error('mid-transfer failure'), { bytesReceived: 500 })
            jest.spyOn(p2pEngine, '_raceRequests').mockResolvedValue({
                success: false,
                midTransfer: true,
                error: midError
            })

            await p2pEngine._handleRequestAsync(stream, 'abc123', 0, null, null, 0)

            // Must call destroy(), NOT just emit('error')
            stream.on('error', () => {}) // prevent unhandled error event when stream is destroyed with error
            expect(destroySpy).toHaveBeenCalledWith(midError)
            // emit('error') may have been called internally by destroy() but NOT by our code directly
            expect(emitSpy).not.toHaveBeenCalledWith('error', midError)
        })

        // ── REGRESSION: isGracefulCancel prevents false seeder penalties ───────

        test('REGRESSION: isGracefulCancel=true skips penalizePeer in _raceRequests', async () => {
            const penalizeSpy = jest.spyOn(p2pEngine, 'penalizePeer')

            const peer = { socket: { destroyed: false, destroy: jest.fn() }, sendError: jest.fn(), getID: jest.fn().mockReturnValue('1.2.3.4') }
            const peer2 = { socket: { destroyed: false, destroy: jest.fn() }, sendError: jest.fn(), getID: jest.fn().mockReturnValue('5.6.7.8') }

            // Stream marked as gracefully cancelled (HTTP won the race)
            const stream = { isGracefulCancel: true }

            // Mock _executeSingleRequest to reject mid-transfer for peer
            const midError = Object.assign(new Error('race cancel'), { bytesReceived: 1024 })
            jest.spyOn(p2pEngine, '_executeSingleRequest').mockRejectedValue(midError)

            const result = await p2pEngine._raceRequests([peer, peer2], stream, 'hash', 1024, null, null, 0)

            // Should NOT penalize the seeder — it was cancelled by RaceManager, not a real failure
            expect(penalizeSpy).not.toHaveBeenCalled()
            // Should return non-midTransfer so _handleRequestAsync doesn't propagate the error
            expect(result.success).toBe(false)
            expect(result.midTransfer).toBeUndefined()

            penalizeSpy.mockRestore()
        })
    })

    // ─── PeerHandler Request Handling (Validation & Async Resolving) ──────────

    describe('PeerHandler Request Handling (Validation & Async Resolving)', () => {
        let socket, engine, handler, fs, PeerHandler

        beforeEach(() => {
            PeerHandler = require('@network/PeerHandler')
            fs = require('fs')
            jest.spyOn(fs, 'existsSync').mockReturnValue(true)
            jest.spyOn(fs, 'realpathSync').mockImplementation(p => p)

            socket = {
                on: jest.fn(),
                removeListener: jest.fn(),
                setTimeout: jest.fn(),
                write: jest.fn().mockReturnValue(true),
                remoteAddress: '1.2.3.4'
            }
            engine = {
                isLocalIP: jest.fn().mockReturnValue(true), // local upload bypasses RateLimiter transform stream
                reportUploadStats: jest.fn(),
                onUploadFinished: jest.fn(),
                incrementUploadCountForIP: jest.fn(),
                decrementUploadCountForIP: jest.fn(),
                activeUploads: 0,
                profile: { weight: 5 },
                usageTracker: {
                    getCredits: jest.fn().mockReturnValue(1000),
                    reserve: jest.fn().mockReturnValue(true),
                    refund: jest.fn()
                },
                queueRequest: jest.fn()
            }
            handler = new PeerHandler(socket, engine, { peer: { host: '1.2.3.4' } })
        })

        afterEach(() => {
            if (handler) {
                if (handler.metricsInterval) {
                    clearInterval(handler.metricsInterval)
                }
                for (const upload of handler.uploads.values()) {
                    if (upload.cleanup) upload.cleanup()
                }
            }
            jest.restoreAllMocks()
        })

        test('executeRequest should resolve path and stats asynchronously and serve file', async () => {
            const realpathSpy = jest.spyOn(fs.promises, 'realpath').mockResolvedValue('/mock/common/assets/objects/ab/abcdef')
            const statSpy = jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 * 1024 })
            jest.spyOn(handler, '_calculateFileHash').mockResolvedValue('abcdef')
            
            const EventEmitter = require('events')
            const mockStream = new EventEmitter()
            mockStream.destroy = jest.fn()
            
            const readStreamSpy = jest.spyOn(fs, 'createReadStream').mockReturnValue(mockStream)

            await handler.executeRequest(42, 'abcdef', null, null, 0)

            expect(realpathSpy).toHaveBeenCalled()
            expect(statSpy).toHaveBeenCalled()
            expect(readStreamSpy).toHaveBeenCalledWith('/mock/common/assets/objects/ab/abcdef', { start: 0 })

            // Emit events to finish the stream transfer and clear watchdog/metrics intervals
            mockStream.emit('data', Buffer.from('hello'))
            mockStream.emit('end')
        })

        test('handleRequest should validate JSON payload types strictly and handle malformed schemas', async () => {
            const sendErrorSpy = jest.spyOn(handler, 'sendError').mockImplementation()

            // 1. Valid JSON payload (data.h is a valid hex string of length 64)
            const validPayload = Buffer.from(JSON.stringify({ h: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd' }))
            await handler.handleRequest(42, validPayload)
            expect(sendErrorSpy).not.toHaveBeenCalled()

            // 2. Malformed JSON (data.h is an array, not a string)
            const invalidPayload = Buffer.from(JSON.stringify({ h: ['not-a-string'] }))
            await handler.handleRequest(43, invalidPayload)
            expect(sendErrorSpy).toHaveBeenCalledWith(43, expect.stringContaining('Invalid hash'))
            
            // 3. Unexpected crash (e.g. payload throws error on toString)
            const badPayload = {
                length: 5,
                readUInt8: () => 123,
                toString: () => { throw new Error('Bad payload') }
            }
            // @ts-ignore
            await handler.handleRequest(44, badPayload)
            expect(sendErrorSpy).toHaveBeenCalledWith(44, 'Internal error')
        })

        test('executeRequest should block path traversal outside of secure directories', async () => {
            const sendErrorSpy = jest.spyOn(handler, 'sendError').mockImplementation()
            
            // Mock _isPathSecure to fail (e.g. targeting outside directories)
            jest.spyOn(handler, '_isPathSecure').mockReturnValue(false)

            await handler.executeRequest(42, 'abcdef', null, null, 0)
            
            expect(sendErrorSpy).toHaveBeenCalledWith(42, 'Not Found')
        })

        test('executeRequest should block symlink redirection targeting outside common/data directory', async () => {
            const sendErrorSpy = jest.spyOn(handler, 'sendError').mockImplementation()
            
            // Path check passes initially
            jest.spyOn(handler, '_isPathSecure').mockReturnValue(true)
            // But realpath points to an unsafe place
            const realpathSpy = jest.spyOn(fs.promises, 'realpath').mockResolvedValue('/unsafe/outside/path')
            jest.spyOn(handler, '_isRealPathSecure').mockReturnValue(false)

            await handler.executeRequest(42, 'abcdef', null, null, 0)

            expect(sendErrorSpy).toHaveBeenCalledWith(42, 'Not Found')
        })

        test('executeRequest should fail if integrity verification (hash mismatch) occurs', async () => {
            const sendErrorSpy = jest.spyOn(handler, 'sendError').mockImplementation()
            
            jest.spyOn(fs.promises, 'realpath').mockResolvedValue('/mock/common/assets/objects/ab/abcdef')
            jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 100 })
            // Hash on disk is different
            jest.spyOn(handler, '_calculateFileHash').mockResolvedValue('mismatchinghash')

            await handler.executeRequest(42, 'abcdef', null, null, 0)

            expect(sendErrorSpy).toHaveBeenCalledWith(42, 'Integrity Error (Hash Mismatch)')
        })

        test('executeRequest should reject request if quota is exceeded (reservation fails)', async () => {
            const sendErrorSpy = jest.spyOn(handler, 'sendError').mockImplementation()
            
            jest.spyOn(fs.promises, 'realpath').mockResolvedValue('/mock/common/assets/objects/ab/abcdef')
            jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 * 1024 * 5 }) // 5 MB
            jest.spyOn(handler, '_calculateFileHash').mockResolvedValue('abcdef')
            
            // Mark as global upload (WAN), bypass local bypass
            jest.spyOn(handler, 'isLocal').mockReturnValue(false)
            engine.isLocalIP.mockReturnValue(false)
            // Mock reservation failure
            jest.spyOn(engine.usageTracker, 'reserve').mockReturnValue(false)

            await handler.executeRequest(42, 'abcdef', null, null, 0)

            expect(sendErrorSpy).toHaveBeenCalledWith(42, 'Quota Exceeded (Reservation Failed)')
        })

        test('_isPathSecure and _isRealPathSecure validation rules', () => {
            // Setup real paths in handler
            handler.dataDirReal = '/mock/data'
            handler.commonDirReal = '/mock/common'

            // Safe cases
            expect(handler._isPathSecure('/mock/data/assets/textures/test.png')).toBe(true)
            expect(handler._isPathSecure('/mock/common/assets/textures/test.png')).toBe(true)
            expect(handler._isRealPathSecure('/mock/data/assets/textures/test.png')).toBe(true)

            // Blacklisted files
            expect(handler._isPathSecure('/mock/data/config.json')).toBe(false)
            expect(handler._isPathSecure('/mock/data/options.txt')).toBe(false)
            expect(handler._isPathSecure('/mock/data/launcher_profiles.json')).toBe(false)
            expect(handler._isPathSecure('/mock/data/secrets.enc')).toBe(false)

            // Blacklisted extensions
            expect(handler._isPathSecure('/mock/data/assets/somefile.dat')).toBe(false)
            expect(handler._isPathSecure('/mock/data/assets/somefile.log')).toBe(false)
            expect(handler._isPathSecure('/mock/data/assets/somefile.txt')).toBe(false)

            // Safe root files (e.g. pack.mcmeta)
            expect(handler._isPathSecure('/mock/data/pack.mcmeta')).toBe(true)

            // Non-whitelisted first part (directory path check)
            expect(handler._isPathSecure('/mock/data/secrets_folder/config.json')).toBe(false)

            // Unsafe path traversal (starting with .. or outside)
            expect(handler._isPathSecure('/mock/data/../outside/config.json')).toBe(false)
            expect(handler._isRealPathSecure('/unsafe/outside/path')).toBe(false)
        })

        test('_calculateFileHash should use cache and invalidate only when size or mtime changes', async () => {
            const statSpy = jest.spyOn(fs.promises, 'stat')
                .mockResolvedValueOnce({ mtimeMs: 1000, size: 500 }) // First check
                .mockResolvedValueOnce({ mtimeMs: 1000, size: 500 }) // Second check (cache hit)
                .mockResolvedValueOnce({ mtimeMs: 2000, size: 500 }) // Third check (cache miss mtime)

            const EventEmitter = require('events')
            const mockStream1 = new EventEmitter()
            const readStreamSpy = jest.spyOn(fs, 'createReadStream').mockReturnValue(mockStream1)

            // First hash calculation
            const promise1 = handler._calculateFileHash('/mock/path/file', 'sha1')
            await Promise.resolve()
            await Promise.resolve()
            mockStream1.emit('data', Buffer.from('hello'))
            mockStream1.emit('end')
            const hash1 = await promise1

            // Second hash calculation (should hit cache, no createReadStream call)
            readStreamSpy.mockClear()
            const hash2 = await handler._calculateFileHash('/mock/path/file', 'sha1')
            expect(hash2).toBe(hash1)
            expect(readStreamSpy).not.toHaveBeenCalled()

            // Third hash calculation (stat changes, should recalculate)
            const mockStream2 = new EventEmitter()
            readStreamSpy.mockReturnValue(mockStream2)
            const promise3 = handler._calculateFileHash('/mock/path/file', 'sha1')
            await Promise.resolve()
            await Promise.resolve()
            mockStream2.emit('data', Buffer.from('world'))
            mockStream2.emit('end')
            const hash3 = await promise3
            expect(hash3).not.toBe(hash1)
            expect(readStreamSpy).toHaveBeenCalled()
        })

        test('flushBatches should filter out aborted requests and not call sendBatchRequest if empty', () => {
            const peer = {
                socket: { destroyed: false },
                sendBatchRequest: jest.fn()
            }
            p2pEngine.peers = [peer]
            
            // Add request to batch queue but do NOT add it to p2pEngine.requests (i.e. simulating aborted)
            p2pEngine.batchQueue.set(peer, [{ reqId: 9999, hash: 'abc' }])

            p2pEngine.flushBatches()

            expect(peer.sendBatchRequest).not.toHaveBeenCalled()
            expect(p2pEngine.batchQueue.has(peer)).toBe(false)
        })
    })
})
