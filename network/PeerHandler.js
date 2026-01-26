const b4a = require('b4a')
const fs = require('fs')
const path = require('path')
const ConfigManager = require('../app/assets/js/configmanager')
const RateLimiter = require('../app/assets/js/core/util/RateLimiter')
const PeerPersistence = require('./PeerPersistence')
const {
    MSG_REQUEST, MSG_DATA, MSG_ERROR, MSG_END,
    MSG_HELLO, MSG_PING, MSG_PONG, MSG_BATCH_REQUEST,
    MAX_CONCURRENT_UPLOADS, BATCH_SIZE_LIMIT
} = require('./constants')

const TrafficState = require('./TrafficState')
const isDev = require('../app/assets/js/isdev')

class PeerHandler {
    constructor(socket, engine, info) {
        this.socket = socket
        this.engine = engine
        this.info = info
        this.buffer = b4a.alloc(0)
        this.processing = false
        this.batchSupport = false
        this.remoteWeight = 0
        this.rtt = 0
        this.wasBusy = false

        // VULNERABILITY FIX (Slowloris): 30s Timeout
        this.socket.setTimeout(30000)
        this.socket.on('timeout', () => {
            // console.warn('[PeerHandler] Socket timeout (Slowloris protection).')
            this.socket.destroy()
        })

        socket.on('data', (data) => {
            // VULNERABILITY FIX 2: Memory Leak DoS Protection
            if (this.buffer.length + data.length > 2 * 1024 * 1024) { // 2MB Hard Limit
                // console.error('[PeerHandler] Buffer overflow. Closing connection.')
                this.socket.destroy()
                return
            }
            this.buffer = b4a.concat([this.buffer, data])
            this.processBuffer()
        })

        socket.on('error', (err) => {
            // console.error('Peer socket error:', err.message)
            this.engine.removePeer(this)
        })

        socket.on('close', () => {
            this.engine.removePeer(this)
        })

        // Send Hello with local weight
        this.sendHello()

        // Measure Latency
        this.pingTimestamp = Date.now()
        this.sendPing()
    }

    processBuffer() {
        if (this.processing) return
        this.processing = true

        while (this.buffer.length >= 9) {
            // Header: Type(1) + ReqID(4) + Len(4)
            const type = this.buffer[0]
            const reqId = this.buffer.readUInt32BE(1)
            const len = this.buffer.readUInt32BE(5)

            // VULNERABILITY FIX 1: OOM Protection
            if (len > 1024 * 1024) { // 1MB Max Message Size
                // console.error('[PeerHandler] Message too large. Closing connection.')
                this.socket.destroy()
                return // Stop processing
            }

            if (this.buffer.length < 9 + len) {
                break // Wait for more data
            }

            const payload = this.buffer.subarray(9, 9 + len)
            this.handleMessage(type, reqId, payload)

            this.buffer = this.buffer.subarray(9 + len)
        }

        this.processing = false
    }

    handleMessage(type, reqId, payload) {
        switch (type) {
            case MSG_REQUEST:
                this.handleRequest(reqId, payload)
                break
            case MSG_DATA:
                this.engine.handleIncomingData(reqId, payload, this) // Pass verified peer
                break
            case MSG_ERROR:
                this.engine.handleIncomingError(reqId, payload, this)
                break
            case MSG_END:
                this.engine.handleIncomingEnd(reqId, this)
                break
            case MSG_HELLO:
                this.handleHello(payload)
                break
            case MSG_PING:
                this.handlePing(reqId)
                break
            case MSG_PONG:
                this.handlePong(reqId)
                break
            case MSG_BATCH_REQUEST:
                this.handleBatchRequest(payload)
                break
        }
    }

    handleHello(payload) {
        if (payload.length >= 1) {
            this.remoteWeight = payload.readUInt8(0)
            // Caps (byte 1)
            if (payload.length >= 2) {
                const caps = payload.readUInt8(1)
                this.batchSupport = (caps & 0x01) === 0x01
            }
            // console.log(`[PeerHandler] Peer weight set to ${this.remoteWeight}`)

            // Persist Peer
            try {
                let ip = this.socket.remoteAddress
                if (!ip) return

                // Unmap IPv4-mapped IPv6 addresses
                if (ip.startsWith('::ffff:')) {
                    ip = ip.substring(7)
                }

                const isLocal = this.engine.isLocalIP(ip)
                const type = isLocal ? 'local' : 'global'
                const publicKey = this.info && this.info.publicKey ? this.info.publicKey.toString('hex') : null

                PeerPersistence.updatePeer(type, {
                    ip,
                    port: this.socket.remotePort,
                    publicKey,
                    score: this.remoteWeight,
                    avgSpeed: 0
                })
            } catch (e) {
                if (isDev) console.error('[PeerHandler] Persistence Error:', e)
            }
        }
    }

    handlePing(reqId) {
        // Reply with PONG
        this.sendPong(reqId)
    }

    handlePong(reqId) {
        // Calculate RTT
        const now = Date.now()
        this.rtt = now - this.pingTimestamp
        // console.log(`[PeerHandler] RTT: ${this.rtt}ms`)
    }

    // Unpack Batch and process individually
    handleBatchRequest(payload) {
        let offset = 0
        if (payload.length < 2) return
        const count = payload.readUInt16BE(offset)
        offset += 2

        for (let i = 0; i < count; i++) {
            if (offset + 5 > payload.length) break
            const reqId = payload.readUInt32BE(offset)
            offset += 4
            const hashLen = payload.readUInt8(offset)
            offset += 1

            if (offset + hashLen > payload.length) break
            const hash = payload.subarray(offset, offset + hashLen)
            offset += hashLen

            // Process individual request (fire and forget / async)
            this.handleRequest(reqId, hash).catch(e => { })
        }
    }

    async handleRequest(reqId, payload) {
        // Seeder Logic
        let hash = payload.toString('utf-8')
        let relPath = null

        // Detect JSON Payload (Starts with '{')
        if (hash.startsWith('{')) {
            try {
                const data = JSON.parse(hash)
                hash = data.h
                relPath = data.p
            } catch (e) {
                // Ignore JSON error, treat as raw hash? Or fail.
            }
        }

        // Sanitize hash to prevent directory traversal
        // Support SHA1 (40 chars) and MD5 (32 chars)
        if (!/^([a-f0-9]{40}|[a-f0-9]{32})$/i.test(hash)) {
            this.sendError(reqId, 'Invalid hash')
            return
        }

        // Sanitize relPath (Allow a-z, 0-9, /, ., _, -)
        if (relPath) {
            // Basic sanitization: No '..'
            if (relPath.includes('..')) relPath = null // Security Risk
        }

        if (isDev) {
            console.debug(`[P2P Debug] Received Request ${reqId} from ${this.socket.remoteAddress} for hash ${hash.substring(0, 8)}...`)
        }

        if (this.engine.activeUploads >= MAX_CONCURRENT_UPLOADS) {
            this.sendError(reqId, 'Busy')
            return
        }

        // VULNERABILITY FIX 3: IP-based Slot Exhaustion
        const remoteIP = this.socket.remoteAddress || 'unknown'
        if (this.engine.getUploadCountForIP(remoteIP) >= 20) { // Max 20 slots per IP
            this.sendError(reqId, 'Busy (IP Limit)')
            return
        }

        // 1. Check if Upload is Enabled (Global OR Local Override)
        const isGlobalUpload = ConfigManager.getP2PUploadEnabled()
        const isLocalUpload = ConfigManager.getLocalOptimization() && this.engine.isLocalIP(remoteIP)

        if (!isGlobalUpload && !isLocalUpload) {
            this.sendError(reqId, 'Disabled')
            return
        }

        // Use TrafficState to check global busy status
        const isBusy = TrafficState.isBusy()

        if (isBusy) {
            if (!this.wasBusy) {
                console.log('[P2PEngine] Smart Mode: Pausing uploads due to active download.')
                this.wasBusy = true
            }
            this.sendError(reqId, 'Owner Busy')
            return
        } else {
            if (this.wasBusy) {
                console.log('[P2PEngine] Smart Mode: Resuming uploads.')
                this.wasBusy = false
            }
        }

        // 3. Update Rate Limiter
        const limitMbps = ConfigManager.getP2PUploadLimit()
        // Convert Mbps to B/s: val * 1024 * 1024 / 8 === val * 131072
        const limitBytes = limitMbps * 125000
        RateLimiter.update(limitBytes, true)

        try {
            const commonDir = ConfigManager.getCommonDirectory()
            const dataDir = ConfigManager.getDataDirectory()

            // Candidate Paths
            const candidates = [
                path.join(commonDir, 'assets', 'objects', hash.substring(0, 2), hash), // Standard
                path.join(dataDir, 'assets', 'objects', hash.substring(0, 2), hash),   // Legacy/Root
                path.join(dataDir, 'common', 'assets', 'objects', hash.substring(0, 2), hash) // Explicit Common
            ]

            if (relPath) {
                // e.g. libraries/com/example/lib.jar
                candidates.push(path.join(commonDir, relPath))
                candidates.push(path.join(dataDir, relPath))
            }

            let foundPath = null
            for (const p of candidates) {
                if (fs.existsSync(p)) {
                    foundPath = p
                    break
                }
            }

            if (isDev && !foundPath) {
                console.debug(`[P2P Debug] File ${hash.substring(0, 8)} not found in candidates:`, candidates)
            }

            if (foundPath) {
                this.engine.activeUploads++
                this.engine.incrementUploadCountForIP(remoteIP)

                const stream = fs.createReadStream(foundPath)

                // Only throttle Global traffic
                let throttled = stream
                if (!this.engine.isLocalIP(remoteIP)) {
                    throttled = stream.pipe(RateLimiter.throttle())
                }

                // Performance Monitoring
                const startTime = Date.now()
                let totalBytesSent = 0
                let errorOccurred = false

                const onSocketClose = () => {
                    if (!stream.destroyed) {
                        errorOccurred = true // Socket died during transfer
                        stream.destroy()
                    }
                }
                this.socket.on('close', onSocketClose)
                this.socket.on('error', onSocketClose)

                // Watchdog
                let lastActivity = Date.now()
                const watchdog = setInterval(() => {
                    if (Date.now() - lastActivity > 15000) {
                        errorOccurred = true // Timeout
                        stream.destroy()
                        clearInterval(watchdog)
                    }
                }, 5000)

                let cleanupDone = false
                const cleanup = () => {
                    if (cleanupDone) return
                    cleanupDone = true

                    this.socket.off('close', onSocketClose)
                    this.socket.off('error', onSocketClose)
                    clearInterval(watchdog)

                    // Report Stats
                    const duration = (Date.now() - startTime) / 1000
                    if (duration > 2) { // Ignore micro-transactions
                        const speed = totalBytesSent / duration // Bytes/sec
                        this.engine.reportUploadStats(speed, errorOccurred)
                    }

                    this.engine.activeUploads = Math.max(0, this.engine.activeUploads - 1)
                    this.engine.decrementUploadCountForIP(remoteIP)
                }

                throttled.on('data', (chunk) => {
                    lastActivity = Date.now()
                    totalBytesSent += chunk.length
                    this.engine.totalUploaded = (this.engine.totalUploaded || 0) + chunk.length
                    this.sendData(reqId, chunk)
                })

                stream.on('end', () => {
                    this.sendEnd(reqId)
                    cleanup()
                })

                stream.on('error', (err) => {
                    errorOccurred = true
                    this.sendError(reqId, 'Read Error')
                    cleanup()
                })

                // Allow cleanup via file close?
                stream.on('close', cleanup)

            } else {
                this.sendError(reqId, 'Not Found')
            }
        } catch (err) {
            this.sendError(reqId, 'Server Error')
        }
    }


    sendData(reqId, data) {
        if (this.socket.destroyed) return; // Guard against dead socket
        const header = b4a.alloc(9)
        header[0] = MSG_DATA
        header.writeUInt32BE(reqId, 1)
        header.writeUInt32BE(data.length, 5)
        this.socket.write(b4a.concat([header, data]))
    }

    sendError(reqId, message) {
        const payload = b4a.from(message, 'utf-8')
        const header = b4a.alloc(9)
        header[0] = MSG_ERROR
        header.writeUInt32BE(reqId, 1)
        header.writeUInt32BE(payload.length, 5)
        this.socket.write(b4a.concat([header, payload]))
    }

    sendEnd(reqId) {
        const header = b4a.alloc(9)
        header[0] = MSG_END
        header.writeUInt32BE(reqId, 1)
        header.writeUInt32BE(0, 5) // No payload
        this.socket.write(header)
    }

    sendHello() {
        // Payload: [Weight (1 byte), Capabilities (1 byte)]
        // Capabilities: Bit 0 = Batch Support
        const localWeight = this.engine.profile.weight
        const payload = b4a.alloc(2)
        payload.writeUInt8(localWeight, 0)
        payload.writeUInt8(0x01, 1) // Advertise Batch Support

        const header = b4a.alloc(9)
        header[0] = MSG_HELLO
        header.writeUInt32BE(0, 1) // reqId 0 for system messages
        header.writeUInt32BE(payload.length, 5)
        this.socket.write(b4a.concat([header, payload]))
    }

    sendPing() {
        const header = b4a.alloc(9)
        header[0] = MSG_PING
        header.writeUInt32BE(0, 1)
        header.writeUInt32BE(0, 5)
        this.socket.write(header)
    }

    sendPong(reqId) {
        const header = b4a.alloc(9)
        header[0] = MSG_PONG
        header.writeUInt32BE(reqId, 1) // Echo reqId if needed, though usually 0 for system
        header.writeUInt32BE(0, 5)
        this.socket.write(header)
    }

    sendRequest(reqId, hash, relPath = null) {
        let payload
        if (relPath) {
            payload = b4a.from(JSON.stringify({ h: hash, p: relPath }), 'utf-8')
        } else {
            payload = b4a.from(hash, 'utf-8')
        }

        const header = b4a.alloc(9)
        header[0] = MSG_REQUEST
        header.writeUInt32BE(reqId, 1)
        header.writeUInt32BE(payload.length, 5)
        this.socket.write(b4a.concat([header, payload]))
    }

    sendBatchRequest(requests) {
        // requests: Array<{ reqId, hash }>
        // Payload: Count(2) + [ReqId(4) + Len(1) + Hash(N)]...

        let totalSize = 2;
        for (const req of requests) {
            totalSize += 4 + 1 + req.hash.length; // Use length of the hash string directly as we convert later? Buffer.byteLength is safer for utf8
        }
        // Wait, wait. Buffer.byteLength(req.hash). earlier in P2PEngine it was Buffer.byteLength
        // Let's stick to Buffer.byteLength
        totalSize = 2;
        for (const req of requests) {
            totalSize += 4 + 1 + Buffer.byteLength(req.hash, 'utf-8');
        }

        const payload = b4a.alloc(totalSize);
        let offset = 0;
        payload.writeUInt16BE(requests.length, offset);
        offset += 2;

        for (const req of requests) {
            payload.writeUInt32BE(req.reqId, offset);
            offset += 4;
            const hashBuf = b4a.from(req.hash, 'utf-8');
            payload.writeUInt8(hashBuf.length, offset);
            offset += 1;
            hashBuf.copy(payload, offset)
            offset += hashBuf.length
        }

        const header = b4a.alloc(9)
        header[0] = MSG_BATCH_REQUEST
        header.writeUInt32BE(0, 1) // ReqID 0 for container messages usually
        header.writeUInt32BE(payload.length, 5)
        this.socket.write(b4a.concat([header, payload]))
    }
}

module.exports = PeerHandler
