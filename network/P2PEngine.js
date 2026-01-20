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

        // VULNERABILITY FIX 3: IP-based Slot Exhaustion
        const remoteIP = this.socket.remoteAddress || 'unknown'
        if (this.engine.getUploadCountForIP(remoteIP) >= 2) { // Max 2 slots per IP
            this.sendError(reqId, 'Busy (IP Limit)')
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
                this.engine.incrementUploadCountForIP(remoteIP)

                const stream = fs.createReadStream(filePath)
                const throttled = stream.pipe(RateLimiter.throttle())

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
        this.activeUploads = 0
        this.uploadCounts = new Map() // IP -> Count

        // Circuit Breaker (Panic Mode)
        this.panicMode = false
        this.attackCounter = 0

        // Debug Info Loop
        if (process.argv.includes('--debug') || true) { // Always on for now as requested "in debug mode..."
            // Check logging level?
            // User said "in debug mode system should inform".
        }
    }

    reportUploadStats(speed, isError) {
        if (!this.uploadHistory) this.uploadHistory = []

        if (isError) {
            NodeAdapter.penaltyWeight()
            if (NodeAdapter.isCritical()) {
                console.log('[P2PEngine] Critical performance drop. Stopping announcement.')
                this.reconfigureSwarm()
            }
            return
        }

        this.uploadHistory.push(speed)
        if (this.uploadHistory.length > 5) this.uploadHistory.shift()

        const avg = this.uploadHistory.reduce((a, b) => a + b, 0) / this.uploadHistory.length

        // 150 KB/s
        if (avg < 153600) {
            const changed = NodeAdapter.downgradeToLow()
            if (changed) {
                this.reconfigureSwarm()
            }
        }
    }

    reconfigureSwarm() {
        if (!this.swarm) return
        const topic = SWARM_TOPIC
        const isPassive = this.profile.passive || NodeAdapter.isCritical() || !ConfigManager.getP2PUploadEnabled()
        console.log(`[P2PEngine] Reconfiguring Swarm. Passive: ${isPassive}`)
        this.swarm.join(topic, { client: true, server: !isPassive })
    }

    triggerCircuitBreaker() {
        if (this.panicMode) return
        this.attackCounter++

        // Threshold: 5 critical verification failures or attacks in short succession
        // To be safe, let's say 3 serious attacks trigger it.
        if (this.attackCounter >= 3) {
            console.error('[P2PEngine] ⚠️ CIRCUIT BREAKER TRIGGERED! ⚠️')
            console.error('[P2PEngine] Excessive attacks detected. Shutting down P2P mesh for protection.')

            this.panicMode = true
            this.stop() // Immediate Shutdown

            // Cool-down: 5 Minutes
            setTimeout(() => {
                console.log('[P2PEngine] Circuit breaker cooling down. Attempting restart...')
                this.panicMode = false
                this.attackCounter = 0
                this.start()
            }, 5 * 60 * 1000)
        }
    }

    getUploadCountForIP(ip) {
        return this.uploadCounts.get(ip) || 0
    }

    incrementUploadCountForIP(ip) {
        const count = this.getUploadCountForIP(ip)
        this.uploadCounts.set(ip, count + 1)
    }

    decrementUploadCountForIP(ip) {
        const count = this.getUploadCountForIP(ip)
        if (count > 0) {
            this.uploadCounts.set(ip, count - 1)
        } else {
            this.uploadCounts.delete(ip)
        }
    }

    _getRoutingTableSize() {
        if (!this.dht) return 0
        // Extensive search for K-Bucket/RoutingTable in HyperDHT structure (v5, v6, v7 compat)
        const candidates = [
            this.dht.nodes,         // Main candidate for v6 (Set or Map)
            this.dht.routingTable,  // v5
            this.dht.table,         // Legacy
            this.dht._dht?.nodes,   // Internal v6
            this.dht.kbucket        // Possible internal K-Bucket
        ]

        for (const table of candidates) {
            if (!table) continue

            // Check for Set/Map size
            if (typeof table.size === 'number') return table.size

            // Check for Array length
            if (Array.isArray(table)) return table.length

            // Check for K-Bucket 'count' method
            if (typeof table.count === 'function') return table.count()

            // Check for K-Bucket 'toArray' method
            if (typeof table.toArray === 'function') return table.toArray().length

            // Legacy length property
            if (typeof table.length === 'number') return table.length
        }

        return 0
    }

    getNetworkInfo() {
        if (!this.totalUploaded) this.totalUploaded = 0

        // Try to get DHT node count (routing table) - Live "Seen" Nodes
        const routingNodes = this._getRoutingTableSize()

        // Check if bootstrapped (approximate)
        // If we have routing nodes, we probably bootstrapped.

        const isEffectivelyPassive = this.profile.passive || !ConfigManager.getP2PUploadEnabled() || NodeAdapter.isCritical()

        return {
            peers: this.peers.length,
            topic: SWARM_TOPIC.toString('hex').substring(0, 8),
            requests: this.requests.size,
            uploads: this.activeUploads,
            uploaded: this.totalUploaded,
            dhtNodes: routingNodes > 0 ? routingNodes : (this.dht && this.dht.bootstrapped ? Config.BOOTSTRAP_NODES.length : 0),
            bootstrapNodes: Config.BOOTSTRAP_NODES.length,
            running: !!this.swarm,
            mode: isEffectivelyPassive ? 'Passive (Leech)' : 'Active (Seed)',
            profile: this.profile.name
        }
    }

    async start() {
        if (!ConfigManager.getGlobalOptimization()) {
            console.log('[P2PEngine] Global Optimization Disabled. Not starting.')
            this.stop()
            return
        }
        if (this.swarm) {
            // Already running, but settings might have changed (e.g. passive mode)
            this.reconfigureSwarm()
            return
        }
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
            // To prevent Hyperswarm from using MDNS (Local Discovery), we pass `local: false` or `mdns: false` depending on version?
            // Hyperswarm v4 doesn't support 'mdns' option directly in constructor, it's part of discovery.
            // But we can try passing it if it helps, mainly we rely on DHT.
            this.dht = new HyperDHT({
                ephemeral: false, // Ensure node is visible in the network
                bootstrap: Config.BOOTSTRAP_NODES.map(n => ({
                    host: n.host,
                    port: n.port,
                    publicKey: n.publicKey ? b4a.from(n.publicKey, 'hex') : undefined
                }))
            })

            this.dht.on('error', (err) => {
                console.error('[P2PEngine] HyperDHT Error:', err)
            })

            this.dht.on('ready', () => {
                const nodesCount = this.dht.nodes ? this.dht.nodes.count() : 0
                console.log('[P2PEngine] HyperDHT Ready. Nodes in Table:', nodesCount)

                // Delayed Bootsrap Check to warn user if connection fails
                setTimeout(() => {
                    const currentNodes = this._getRoutingTableSize()
                    if (currentNodes === 0 && !this.dht.bootstrapped) {
                        console.warn(`[P2PEngine] [WARNING] No DHT connections established after 5s. \nPossible causes: UDP blocked, Bootstraps offline. \nTarget Bootstraps: ${JSON.stringify(Config.BOOTSTRAP_NODES)}`)
                    } else if (currentNodes > 0 || this.dht.bootstrapped) {
                        console.log(`[P2PEngine] DHT Status: ${this.dht.bootstrapped ? 'Connected to Bootstrap' : 'Searching...'} | Nodes in Routing Table: ${currentNodes}`)
                    }
                }, 5000)
            })

            // Disable local discovery to avoid conflict with P2PManager (UDP)
            // Hyperswarm (if using recent version) might use 'local' option?
            // If not supported, we rely on P2PManager being faster.
            this.swarm = new Hyperswarm({ dht: this.dht, local: false, mdns: false })

            this.swarm.on('connection', (socket, info) => {
                const peer = new PeerHandler(socket, this)
                this.peers.push(peer)
                console.log(`[P2PEngine] Connected to peer: ${info.publicKey.toString('hex').substring(0, 8)}... (Total: ${this.peers.length})`)

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
            const isPassive = this.profile.passive || !ConfigManager.getP2PUploadEnabled() || NodeAdapter.isCritical()

            const discovery = this.swarm.join(SWARM_TOPIC, {
                server: !isPassive,
                client: true
            })



            discovery.flushed().then(() => {
                console.log('[P2PEngine] Topic successfully published to DHT')
            })

            console.log(`[P2PEngine] Initialized. Topic: ${b4a.toString(SWARM_TOPIC, 'hex').substring(0, 8)}... Passive: ${isPassive}`)

        } catch (err) {
            console.error('[P2PEngine] Init failed:', err)
        }
    }

    requestFile(hash, expectedSize = 0) {
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
        if (this.reqIdCounter > 4294967295) this.reqIdCounter = 1 // VULNERABILITY FIX 4: ReqId Overflow Wrap-around

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
            expectedSize,
            timestamp: Date.now()
        })

        // Send request
        peer.sendRequest(reqId, hash)

        // Memory Leak Fix for "Stale Request Map"
        stream.on('close', () => {
            if (this.requests.has(reqId)) {
                this.requests.delete(reqId)
            }
        })

        // Timeout fallback
        setTimeout(() => {
            if (this.requests.has(reqId)) {
                this.requests.delete(reqId)
                stream.emit('error', new Error('P2P Timeout'))
            }
        }, Config.PROTOCOL.TIMEOUT)

        return stream
    }

    handleIncomingData(reqId, data, senderPeer) {
        const req = this.requests.get(reqId)
        if (req) {
            // VULNERABILITY FIX 1: ReqID Spoofing Protection
            if (req.peer !== senderPeer) {
                // console.warn('[P2P] Spoofed Data Packet detected. Dropping.')
                return
            }

            req.bytesReceived = (req.bytesReceived || 0) + data.length

            // VULNERABILITY FIX ("Infinite File"): Size Check
            if (req.expectedSize > 0 && req.bytesReceived > req.expectedSize) {
                req.stream.emit('error', new Error('File size exceeded expected limit'))
                this.requests.delete(reqId)
                // Trigger Circuit Breaker on obvious attack
                this.triggerCircuitBreaker()
                return
            }

            req.stream.push(data)
        }
    }

    handleIncomingEnd(reqId, senderPeer) {
        const req = this.requests.get(reqId)
        if (req) {
            // VULNERABILITY FIX 1: ReqID Spoofing Protection
            if (req.peer !== senderPeer) return;

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

    handleIncomingError(reqId, messageBuffer, senderPeer) {
        const req = this.requests.get(reqId)
        if (req) {
            // VULNERABILITY FIX 1: ReqID Spoofing Protection
            if (req.peer !== senderPeer) return;

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
