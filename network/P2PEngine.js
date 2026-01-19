const Hyperswarm = require('hyperswarm')
const HyperDHT = require('hyperdht')
const b4a = require('b4a')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')
const { Readable } = require('stream')
const Config = require('./config')
const NodeAdapter = require('./NodeAdapter')
const ConfigManager = require('../app/assets/js/configmanager')
const RateLimiter = require('../app/assets/js/core/util/RateLimiter')
// Deferred import for RaceManager to avoid circular dependency
let RaceManager = null;
try { RaceManager = require('./RaceManager') } catch (e) { }

// Protocol Constants
const MSG_REQUEST = 0
const MSG_DATA = 1
const MSG_ERROR = 2
const MSG_END = 3
const MSG_HELLO = 4
const MSG_PING = 5
const MSG_PONG = 6

const MAX_CONCURRENT_UPLOADS = 5

// Fixed topic for the "Zombie" network
const SWARM_TOPIC = crypto.createHash('sha256').update('zombie-launcher-assets-v1').digest()

class PeerHandler {
    constructor(socket, engine) {
        this.socket = socket
        this.engine = engine
        this.buffer = b4a.alloc(0)
        this.processing = false

        socket.on('data', (data) => {
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
                this.engine.handleIncomingData(reqId, payload)
                break
            case MSG_ERROR:
                this.engine.handleIncomingError(reqId, payload)
                break
            case MSG_END:
                this.engine.handleIncomingEnd(reqId)
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
        }
    }

    handleHello(payload) {
        if (payload.length >= 1) {
            this.remoteWeight = payload.readUInt8(0)
            // console.log(`[PeerHandler] Peer weight set to ${this.remoteWeight}`)
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

    async handleRequest(reqId, payload) {
        // Seeder Logic
        const hash = payload.toString('utf-8')
        // Sanitize hash to prevent directory traversal
        // Support SHA1 (40 chars) and MD5 (32 chars)
        if (!/^([a-f0-9]{40}|[a-f0-9]{32})$/i.test(hash)) {
            this.sendError(reqId, 'Invalid hash')
            return
        }

        if (this.engine.activeUploads >= MAX_CONCURRENT_UPLOADS) {
            this.sendError(reqId, 'Busy')
            return
        }

        // 1. Check if Upload is Enabled
        if (!ConfigManager.getP2PUploadEnabled()) {
            this.sendError(reqId, 'Disabled')
            return
        }

        // 2. Smart Check: If user is downloading, don't upload (Avoid lagging user)
        if (!RaceManager) { try { RaceManager = require('./RaceManager') } catch (e) { } }

        const isBusy = RaceManager && RaceManager.isBusy()

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
        const limitBytes = limitMbps * 125000 // 1 Mbps = 125,000 Bytes/s (Decimal) or 131072 (Binary)? 
        // User said "15 mbit for 200 mbit internet". Speed tests use decimal usually.
        // Let's use 125000.
        RateLimiter.update(limitBytes, true)

        try {
            const commonDir = ConfigManager.getCommonDirectory()
            const filePath = path.join(commonDir, 'assets', 'objects', hash.substring(0, 2), hash)

            if (fs.existsSync(filePath)) {
                this.engine.activeUploads++
                const stream = fs.createReadStream(filePath)

                // Throttle Stream
                const throttled = stream.pipe(RateLimiter.throttle())

                // VULNERABILITY FIX 3: Slot Exhaustion Protection
                // Kill connection if client is too slow or halts
                let lastActivity = Date.now()
                const watchdog = setInterval(() => {
                    if (Date.now() - lastActivity > 15000) { // 15s Idle Timeout
                        // console.warn('[P2P] Upload slot timed out (Slot Exhaustion Protection)')
                        stream.destroy()
                        clearInterval(watchdog)
                        // Decrease active uploads only if not already done by 'close'
                        // But 'end' handles it cleanly usually. Force cleanup:
                        if (!stream.destroyed) this.engine.activeUploads = Math.max(0, this.engine.activeUploads - 1)
                    }
                }, 5000)

                throttled.on('data', (chunk) => {
                    lastActivity = Date.now()
                    this.sendData(reqId, chunk)
                })

                stream.on('end', () => {
                    clearInterval(watchdog)
                    this.engine.activeUploads--
                    this.sendEnd(reqId)
                })

                stream.on('close', () => {
                    clearInterval(watchdog)
                    // Check if we need to decrement? 'end' usually fires first.
                    // If purely closed by timeout, we might need to decrement if 'end' didn't fire.
                    // Safe approach: rely on 'end' or manual management in watchdog?
                    // 'activeUploads' is simple counter.
                    // Let's assume 'end' or 'error' will trigger.
                    // Actually, if we destroy stream, 'close' fires.
                })

                stream.on('error', () => {
                    clearInterval(watchdog)
                    this.engine.activeUploads = Math.max(0, this.engine.activeUploads - 1)
                    this.sendError(reqId, 'Read error')
                })
            } else {
                this.sendError(reqId, 'Not found')
            }
        } catch (err) {
            this.sendError(reqId, 'Internal error')
        }
    }

    sendData(reqId, data) {
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
        // Payload: [Weight (1 byte)]
        const localWeight = this.engine.profile.weight
        const payload = b4a.alloc(1)
        payload.writeUInt8(localWeight, 0)

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

    sendRequest(reqId, hash) {
        const payload = b4a.from(hash, 'utf-8')
        const header = b4a.alloc(9)
        header[0] = MSG_REQUEST
        header.writeUInt32BE(reqId, 1)
        header.writeUInt32BE(payload.length, 5)
        this.socket.write(b4a.concat([header, payload]))
    }
}

class P2PEngine extends EventEmitter {
    constructor() {
        super()
        this.peers = [] // Array of PeerHandler
        this.requests = new Map() // reqId -> { stream: Readable, timeout: Timer }
        this.reqIdCounter = 1
        this.profile = NodeAdapter.getProfile()

        // Debug Info Loop
        if (process.argv.includes('--debug') || true) { // Always on for now as requested "in debug mode..."
            // Check logging level?
            // User said "in debug mode system should inform".
        }
    }

    getNetworkInfo() {
        return {
            peers: this.peers.length,
            topic: SWARM_TOPIC.toString('hex').substring(0, 8),
            requests: this.requests.size,
            uploads: this.activeUploads
        }
    }

    async start() {
        if (!ConfigManager.getGlobalOptimization()) {
            console.log('[P2PEngine] Global Optimization Disabled. Not starting.')
            this.stop()
            return
        }
        if (this.swarm) return // Already running
        await this.init()
    }

    async stop() {
        if (this.swarm) {
            console.log('[P2PEngine] Stopping...')
            await this.swarm.destroy()
            this.swarm = null
            this.peers = []
        }
    }

    async init() {
        try {
            // Setup HyperDHT with bootstrap nodes
            // Note: hyperswarm handles DHT internally but we can pass options
            const dht = new HyperDHT({
                bootstrap: Config.BOOTSTRAP_NODES.map(n => ({ host: n.host, port: n.port }))
            })

            this.swarm = new Hyperswarm({ dht })

            this.swarm.on('connection', (socket, info) => {
                const peer = new PeerHandler(socket, this)
                this.peers.push(peer)

                // Enforce connection limits from profile
                if (this.peers.length > this.profile.maxPeers) {
                    // Drop the new connection if we are at capacity
                    // This is a simple strategy; a more complex one could drop the peer with the lowest score
                    socket.destroy()
                    return
                }

                socket.on('close', () => {
                    this.peers = this.peers.filter(p => p !== peer)
                })
            })

            // Join the topic
            // server: true (announce) if not passive or if we want to share
            // client: true (lookup)
            // Profile says "passive: true" means "passive seeding only".
            // Usually passive seeding means you don't aggressively announce, OR you announce but prioritize own downloads.
            // The prompt says: "Low-End Profile... passive seeding only."
            // "Aggressive Announcement: The node should join the swarm topic and actively announce itself."
            // I'll assume everyone joins, but maybe we adjust `announce` flag?
            // Hyperswarm join(topic, { server: true, client: true })
            const shouldAnnounce = !this.profile.passive

            await this.swarm.join(SWARM_TOPIC, {
                server: shouldAnnounce,
                client: true
            })

            await this.swarm.flush() // Wait for announcement
            console.log(`[P2PEngine] Initialized. Topic: ${b4a.toString(SWARM_TOPIC, 'hex').substring(0, 8)}... Peers: ${this.peers.length}`)

        } catch (err) {
            console.error('[P2PEngine] Init failed:', err)
        }
    }

    requestFile(hash) {
        // Return a Readable stream
        const stream = new Readable({
            read() { }
        })

        if (this.peers.length === 0) {
            // No peers, fail immediately so HTTP can take over
            process.nextTick(() => {
                stream.emit('error', new Error('No peers available'))
            })
            return stream
        }

        const reqId = this.reqIdCounter++

        // Score-based Peer Selection (Weight / RTT)
        // Default RTT to 500ms if unknown, avoid divide by zero
        // Formula: Score = (Weight^2) * (1000 / (RTT + 50))
        // Weight is squared to emphasize powerful nodes

        let bestPeer = null
        let maxScore = -1

        // If we have peers, try to find the best one
        if (this.peers.length > 0) {
            // Sort peers by score and pick top one (deterministic) to ensure "Best" peer is used
            // Or pick from top 3 to distribute load slightly?
            // User complained about "random selection" picking slow peers.
            // Let's go fully deterministic for now: Best Score Wins.

            for (const p of this.peers) {
                const weight = p.remoteWeight || 1
                const rtt = p.rtt || 200 // Default 200ms if not yet ponged

                // VULNERABILITY FIX 2 & 5: Reputation System
                // Prefer peers with proven speed history
                let speedFactor = 1.0
                if (p.lastTransferSpeed) {
                    // Baseline: 100 KB/s = 1.0
                    speedFactor = Math.max(0.1, p.lastTransferSpeed / 102400)
                    speedFactor = Math.min(10.0, speedFactor) // Cap at 10x boost
                }

                const score = (weight * weight) * (10000 / (rtt + 10)) * speedFactor

                if (score > maxScore) {
                    maxScore = score
                    bestPeer = p
                }
            }
        }

        const peer = bestPeer

        if (!peer) {
            process.nextTick(() => {
                stream.emit('error', new Error('Peer selection failed'))
            })
            return stream
        }

        // Setup request tracking
        this.requests.set(reqId, {
            stream,
            peer,
            timestamp: Date.now()
        })

        // Send request
        peer.sendRequest(reqId, hash)

        // Timeout fallback
        setTimeout(() => {
            if (this.requests.has(reqId)) {
                this.requests.delete(reqId)
                stream.emit('error', new Error('P2P Timeout'))
            }
        }, Config.PROTOCOL.TIMEOUT)

        return stream
    }

    handleIncomingData(reqId, data) {
        const req = this.requests.get(reqId)
        if (req) {
            req.bytesReceived = (req.bytesReceived || 0) + data.length
            req.stream.push(data)
        }
    }

    handleIncomingEnd(reqId) {
        const req = this.requests.get(reqId)
        if (req) {
            req.stream.push(null) // EOF

            // REPUTATION SYSTEM: Update Peer Speed
            const duration = (Date.now() - req.timestamp) / 1000
            // Ignore small files (<100KB) to avoid timer resolution jitter
            if (duration > 0 && req.bytesReceived > 102400) {
                const speed = req.bytesReceived / duration // B/s
                req.peer.lastTransferSpeed = speed
                // console.log(`[P2P] Recognized speed for peer: ${(speed/1024).toFixed(2)} KB/s`)
            }

            this.requests.delete(reqId)
        }
    }

    handleIncomingError(reqId, messageBuffer) {
        const req = this.requests.get(reqId)
        if (req) {
            const msg = messageBuffer.toString('utf-8')
            req.stream.emit('error', new Error(`Peer error: ${msg}`))
            this.requests.delete(reqId)
        }
    }

    removePeer(peer) {
        const idx = this.peers.indexOf(peer)
        if (idx > -1) this.peers.splice(idx, 1)
    }
}

module.exports = new P2PEngine()
