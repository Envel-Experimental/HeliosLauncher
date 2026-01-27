const b4a = require('b4a')
const fs = require('fs')
const os = require('os')
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

    getIP() {
        let ip = (this.info && this.info.peer && this.info.peer.host) || this.socket.remoteAddress || (this.socket.rawStream && this.socket.rawStream.remoteAddress) || 'unknown'
        if (typeof ip === 'string' && ip.startsWith('::ffff:')) ip = ip.substring(7)
        return ip
    }

    getID() {
        const ip = this.getIP()
        // If IP is unknown, use the Public Key as a stable, unique ID
        if (ip === 'unknown' && this.info && this.info.publicKey) {
            return b4a.toString(this.info.publicKey, 'hex')
        }
        return ip
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
        const rawCount = payload.readUInt16BE(offset)
        const count = Math.min(rawCount, BATCH_SIZE_LIMIT)
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
        let fileId = null

        // Detect JSON Payload (Starts with '{')
        // VULNERABILITY FIX: Cap JSON length and validate type
        if (payload.length > 0 && payload[0] === 123) { // 123 is '{'
            if (payload.length > 1024) { // 1KB Max for JSON payload
                this.sendError(reqId, 'JSON Payload Too Large')
                return
            }
            try {
                const data = JSON.parse(hash)
                if (data && typeof data === 'object') {
                    hash = String(data.h || '').trim()
                    relPath = (data.p && typeof data.p === 'string') ? data.p.trim() : null
                    fileId = (data.id && typeof data.id === 'string') ? data.id.trim() : null
                }
            } catch (e) {
                if (isDev) console.warn('[P2P Security] Malformed JSON from peer')
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
            relPath = relPath.trim()
            // Basic sanitization: No '..'
            if (relPath.includes('..')) relPath = null // Security Risk
            if (path.isAbsolute(relPath)) relPath = null // Local path leakage
        }

        if (fileId) {
            fileId = fileId.trim()
            if (fileId.includes('..')) fileId = null
            if (path.isAbsolute(fileId)) fileId = null
        }

        hash = hash.trim()

        let remoteIP = this.socket.remoteAddress || this.socket.remoteHost || (this.socket.rawStream && this.socket.rawStream.remoteAddress)
        if (!remoteIP && this.info && this.info.peer) remoteIP = this.info.peer.host
        if (!remoteIP) remoteIP = 'unknown'

        if (isDev) {
            // console.log(`%c[P2PEngine] Connection Established with ${remoteIP}`, 'color: #00ff00; font-weight: bold')
            // console.debug(`[P2P Debug] Received Request ${reqId} for hash ${hash.substring(0, 8)}... (ID: ${fileId || 'n/a'})`)
        }

        const isGlobalUpload = ConfigManager.getP2PUploadEnabled()
        const isLocalUpload = ConfigManager.getLocalOptimization() && this.engine.isLocalIP(remoteIP)

        // Bypass limits for LAN peers
        if (!isLocalUpload) {
            // 2. Fair Usage Check (Soft Ban)
            const { MIN_CREDITS_TO_START } = require('./constants')
            const credits = this.engine.usageTracker.getCredits(remoteIP)

            if (credits < MIN_CREDITS_TO_START) {
                if (isDev) console.warn(`[P2P FairUsage] Soft-banning ${remoteIP} (Credits: ${credits.toFixed(1)} MB)`)
                this.sendError(reqId, 'Busy (Fair Usage Cooling)')
                return
            }

            // Queue request via Engine
            this.engine.queueRequest(this, reqId, hash, relPath, fileId)
            return // Stop execution here, wait for queue processing
        }

        // LAN peers bypass queue/limits largely, but we could still queue them?
        // For now, let LAN bypass queue for max speed.
        this.executeRequest(reqId, hash, relPath, fileId)
    }

    async executeRequest(reqId, hash, relPath, fileId) {
        let remoteIP = this.socket.remoteAddress || this.socket.remoteHost || (this.socket.rawStream && this.socket.rawStream.remoteAddress)
        if (!remoteIP && this.info && this.info.peer) remoteIP = this.info.peer.host
        if (!remoteIP) remoteIP = 'unknown'

        const isLocalUpload = ConfigManager.getLocalOptimization() && this.engine.isLocalIP(remoteIP)
        const limitMbps = isLocalUpload ? 10000 : ConfigManager.getP2PUploadLimit() // 10 Gbps for local
        // Convert Mbps to B/s
        const limitBytes = limitMbps * 125000
        RateLimiter.update(limitBytes, true)

        try {
            const commonDir = ConfigManager.getCommonDirectory().trim()
            const dataDir = ConfigManager.getDataDirectory().trim()

            // Candidate Paths (Normalized)
            const candidates = [
                path.resolve(path.join(commonDir, 'assets', 'objects', hash.substring(0, 2), hash)),
                path.resolve(path.join(dataDir, 'assets', 'objects', hash.substring(0, 2), hash)),
                path.resolve(path.join(dataDir, 'common', 'assets', 'objects', hash.substring(0, 2), hash)),
                path.resolve(path.join(dataDir, 'common', 'common', 'assets', 'objects', hash.substring(0, 2), hash))
            ]

            if (relPath) {
                candidates.push(path.resolve(path.join(commonDir, relPath)))
                candidates.push(path.resolve(path.join(dataDir, relPath)))
                // Try recursive-ish fallbacks for common assets
                candidates.push(path.resolve(path.join(dataDir, 'common', relPath)))
                candidates.push(path.resolve(path.join(dataDir, 'minecraft', relPath)))
            }

            if (fileId) {
                candidates.push(path.resolve(path.join(commonDir, fileId)))
                candidates.push(path.resolve(path.join(dataDir, fileId)))
                candidates.push(path.resolve(path.join(dataDir, 'common', fileId)))
            }

            // INSTANCE SEARCH: Removed as instances are user-mutable and not intended for P2P distribution


            // Deduplicate and filter any invalid paths
            const uniqueCandidates = [...new Set(candidates)].filter(p => p && p.length > 5)

            let foundPath = null
            for (const p of uniqueCandidates) {
                // SECURITY CHECK: Whitelist Validation
                if (!this._isPathSecure(p)) {
                    if (isDev) {
                        const dataDir = ConfigManager.getDataDirectory().trim()
                        const rel = path.relative(dataDir, p)
                        console.warn(`[P2P Security] Blocked access to unsafe path: ${p} (Rel: ${rel}, DataDir: ${dataDir})`)
                    }
                    continue
                }

                try {
                    if (fs.existsSync(p)) {
                        foundPath = p
                        break
                    }
                } catch (e) {
                    if (isDev) console.error(`[P2P Debug] Error checking path ${p}:`, e.message)
                }
            }

            if (isDev && !foundPath) {
                console.debug(`[P2P Debug] File ${hash.substring(0, 8)} (ID: ${fileId || 'n/a'}) not found. Checked ${uniqueCandidates.length} paths:`)
                for (const p of uniqueCandidates) {
                    const exists = fs.existsSync(p)
                    console.debug(`  - [${exists ? 'EXIST' : 'MISS'}] ${p}`)
                }

                // Diagnosis: Let's see what's actually in the folders we checked
                const parent = path.dirname(uniqueCandidates[0])
                try {
                    if (fs.existsSync(parent)) {
                        const files = fs.readdirSync(parent)
                        console.debug(`[P2P Debug] Parent folder ${parent} exists and contains ${files.length} files.`)
                        if (files.length > 0) {
                            console.debug(`[P2P Debug] Sample files in parent: ${files.slice(0, 5).join(', ')}`)
                        }
                        if (files.includes(hash)) {
                            console.error(`[P2P Debug] CRITICAL: fs.existsSync failed but file IS in readdir! Path: ${uniqueCandidates[0]}`)
                        } else if (fileId && files.includes(path.basename(fileId))) {
                            console.debug(`[P2P Debug] Found file by ID in readdir: ${fileId}`)
                        }
                    } else {
                        console.debug(`[P2P Debug] Parent folder MISSING: ${parent}`)
                        // Check one level up (objects)
                        const objDir = path.dirname(parent)
                        if (fs.existsSync(objDir)) {
                            console.debug(`[P2P Debug] But 'objects' dir exists: ${objDir}`)
                        }
                    }
                } catch (e) { }
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

                // Watchdog: Disconnect if no data for 30s
                let lastActivity = Date.now()
                const watchdog = setInterval(() => {
                    if (Date.now() - lastActivity > 30000) {
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

                        // Only report as "Error" if it was a real performance failure (timed out or socket died with low speed)
                        // This prevents "Not Found" or "Busy" from penalizing the seeder's reputation.
                        const isRealFailure = errorOccurred && speed < 102400 // Less than 100KB/s on failure
                        this.engine.reportUploadStats(speed, isRealFailure)
                    }

                    this.engine.activeUploads = Math.max(0, this.engine.activeUploads - 1)
                    this.engine.decrementUploadCountForIP(remoteIP)
                    this.engine.onUploadFinished()

                    // Consume credits based on amount transferred (MB)
                    if (!isLocalUpload) {
                        const transferredMB = totalBytesSent / (1024 * 1024)
                        this.engine.usageTracker.consume(remoteIP, transferredMB)
                    }
                }

                throttled.on('data', (chunk) => {
                    lastActivity = Date.now()
                    totalBytesSent += chunk.length

                    const isLocal = this.engine.isLocalIP(remoteIP)
                    if (isLocal) {
                        this.engine.totalUploadedLocal = (this.engine.totalUploadedLocal || 0) + chunk.length
                    } else {
                        this.engine.totalUploadedGlobal = (this.engine.totalUploadedGlobal || 0) + chunk.length
                    }

                    this.engine.totalUploaded = (this.engine.totalUploaded || 0) + chunk.length
                    this.sendData(reqId, chunk)
                })

                if (isDev) {
                    // console.log(`[P2P Debug] Seeding file: ${foundPath} to ${remoteIP}`)
                }
                stream.on('end', () => {
                    this.sendEnd(reqId)
                    // if (isDev) console.log(`[P2P Debug] Upload Finished: ${foundPath} (${totalBytesSent} bytes)`)
                    cleanup()
                })

                stream.on('error', (err) => {
                    errorOccurred = true
                    if (isDev) console.error(`[P2P Debug] Read Error on ${foundPath}:`, err.message)
                    this.sendError(reqId, 'Read Error')
                    cleanup()
                })

                // Allow cleanup via file close?
                stream.on('close', cleanup)

            } else {
                this.sendError(reqId, 'Not Found')
            }
        } catch (err) {
            console.error('[PeerHandler] Request Handling Error:', err)
            this.sendError(reqId, 'Server Error')
        }
    }

    getIP() {
        let ip = this.socket.remoteAddress || this.socket.remoteHost || (this.socket.rawStream && this.socket.rawStream.remoteAddress)
        if (!ip && this.info && this.info.peer) ip = this.info.peer.host
        if (ip && ip.startsWith('::ffff:')) ip = ip.substring(7)
        return ip || 'unknown'
    }

    isLocal() {
        if (this.info && this.info.local) return true
        return this.engine.isLocalIP(this.getIP())
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

    sendRequest(reqId, hash, relPath = null, fileId = null) {
        let payload
        if (relPath || fileId) {
            payload = b4a.from(JSON.stringify({ h: hash, p: relPath, id: fileId }), 'utf-8')
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

    _isPathSecure(filePath) {
        try {
            const dataDir = ConfigManager.getDataDirectory().trim()
            const rel = path.relative(dataDir, filePath)

            // Block paths outside dataDir
            if (rel.startsWith('..') || path.isAbsolute(rel)) return false

            const normalizedRel = rel.replace(/\\/g, '/')
            const parts = normalizedRel.split('/')
            const firstPart = parts[0]
            const fileName = parts[parts.length - 1]

            // STRICT BLACKLIST (Sensitive files)
            const blacklist = ['config.json', 'distribution.json', 'peers.json', 'version_manifest_v2.json']
            if (blacklist.includes(fileName)) {
                if (isDev) console.warn(`[P2P Security] Blocked blacklisted file: ${fileName}`)
                return false
            }
            if (fileName.endsWith('.enc')) {
                if (isDev) console.warn(`[P2P Security] Blocked encrypted file: ${fileName}`)
                return false
            }

            // STRICT WHITELIST
            const whitelist = ['assets', 'libraries', 'versions', 'common', 'icons', 'minecraft']

            return whitelist.includes(firstPart)
        } catch (e) {
            console.error('[P2P Security] Path check failed:', e)
            return false // Fail closed
        }
    }
}

module.exports = PeerHandler
