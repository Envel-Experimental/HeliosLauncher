const Hyperswarm = require('hyperswarm')
const HyperDHT = require('hyperdht')
const b4a = require('b4a')
const os = require('os')
const crypto = require('crypto')
const { EventEmitter } = require('events')
const { Readable } = require('stream')
const Config = require('./config')
const NodeAdapter = require('./NodeAdapter')
const ConfigManager = require('../app/assets/js/configmanager')
const PeerHandler = require('./PeerHandler')
const TrafficState = require('./TrafficState')
const PeerPersistence = require('./PeerPersistence')

// Fixed topic for the "Zombie" network
const { SWARM_TOPIC_SEED } = require('./constants')
const isDev = require('../app/assets/js/isdev')

// Fixed topic for the "Zombie" network
const SWARM_TOPIC = crypto.createHash('sha256').update(SWARM_TOPIC_SEED).digest()

class UsageTracker {
    constructor() {
        this.data = new Map() // IP -> { credits: number, lastUpdate: number }
    }

    getCredits(key) {
        const { MAX_CREDITS_PER_IP, CREDIT_REGEN_RATE } = require('./constants')
        let entry = this.data.get(key)

        if (!entry) {
            // Memory Guard: Cap tracker size
            if (this.data.size > 5000) {
                const firstKey = this.data.keys().next().value
                this.data.delete(firstKey)
            }
            entry = { credits: MAX_CREDITS_PER_IP * 0.5, lastUpdate: Date.now() } // Start with 2.5GB for new IPs
            this.data.set(key, entry)
            return entry.credits
        }

        // Apply Regeneration
        const now = Date.now()
        const elapsedSec = (now - entry.lastUpdate) / 1000
        const regen = elapsedSec * CREDIT_REGEN_RATE

        entry.credits = Math.min(MAX_CREDITS_PER_IP, entry.credits + regen)
        entry.lastUpdate = now

        return entry.credits
    }

    consume(key, amountMB) {
        const current = this.getCredits(key)
        const entry = this.data.get(key)
        if (entry) {
            entry.credits = Math.max(0, current - (typeof amountMB === 'number' ? amountMB : 0))
        }
    }

    reserve(key, amountMB) {
        const current = this.getCredits(key)
        if (current >= amountMB) {
            const entry = this.data.get(key)
            entry.credits -= amountMB
            return true
        }
        return false
    }

    refund(key, amountMB) {
        const { MAX_CREDITS_PER_IP } = require('./constants')
        const entry = this.data.get(key)
        if (entry) {
            entry.credits = Math.min(MAX_CREDITS_PER_IP, entry.credits + amountMB)
        }
    }

    cleanup() {
        const now = Date.now()
        // Remove entries older than 2 hours
        for (const [key, entry] of this.data.entries()) {
            if (now - entry.lastUpdate > 7200000) {
                this.data.delete(key)
            }
        }
    }
}

class P2PEngine extends EventEmitter {
    constructor() {
        super()
        this.peers = [] // Array of PeerHandler
        this.requests = new Map() // reqId -> { stream: Readable, timeout: Timer }
        this.blacklist = new Set() // IP/PubKey strings
        this.peerStrikes = new Map() // Peer IP -> strikes count
        this.setMaxListeners(100)
        this.usageTracker = new UsageTracker()

        this.starting = false
        this.stopping = false
        this._discoveryPromise = null
        this.profile = NodeAdapter.getProfile()
        this.activeUploads = 0
        this.uploadCounts = new Map() // IP -> Count

        this.totalUploaded = 0
        this.totalDownloaded = 0

        this.totalUploadedLocal = 0
        this.totalUploadedGlobal = 0
        this.totalDownloadedLocal = 0
        this.totalDownloadedGlobal = 0

        // Batching
        this.batchQueue = new Map() // Peer -> Array<{ reqId, hash }>
        this.batchFlushScheduled = false

        // Circuit Breaker (Panic Mode)
        this.panicMode = false
        this.attackCounter = 0

        this.raceManager = null
        this.discoveryLogThrottled = false

        // Periodic Memory Cleanup
        setInterval(() => {
            this.usageTracker.cleanup()
            // Cleanup strikes older than 30 mins
            const now = Date.now()
            if (this._lastCleanup && now - this._lastCleanup < 1800000) return
            this._lastCleanup = now

            for (const [ip, strikes] of this.peerStrikes.entries()) {
                // If strikes are high, they are likely in blacklist (which has its own timer)
                // We just clear the strike counter periodically to save memory
                this.peerStrikes.delete(ip)
            }
        }, 300000) // Every 5 minutes

        // Dynamic Bandwidth Management
        this.currentDownloadSpeed = 0
        this.currentUploadSpeed = 0
        this.currentDownloadSpeedLocal = 0
        this.currentUploadSpeedLocal = 0
        this.downloadBytesLocal = 0
        this.downloadBytesGlobal = 0
        this.uploadBytesLocal = 0
        this.uploadBytesGlobal = 0
        this.maxObservedDownloadSpeed = 0
        this.highBandwidthMode = false
        this.lastLimitUpdate = 0

        // Speed & Resource Monitor (Every 2 seconds)
        setInterval(() => {
            this.currentDownloadSpeed = this.downloadBytesGlobal / 2 // B/s
            this.currentUploadSpeed = this.uploadBytesGlobal / 2 // B/s
            this.currentDownloadSpeedLocal = this.downloadBytesLocal / 2 // B/s
            this.currentUploadSpeedLocal = this.uploadBytesLocal / 2 // B/s

            this.downloadBytesLocal = 0
            this.downloadBytesGlobal = 0
            this.uploadBytesLocal = 0
            this.uploadBytesGlobal = 0

            if (this.currentDownloadSpeed > this.maxObservedDownloadSpeed) {
                this.maxObservedDownloadSpeed = this.currentDownloadSpeed
            }

            // High Bandwidth Detection (> 10 MB/s)
            if (this.currentDownloadSpeed > 10 * 1024 * 1024) {
                if (!this.highBandwidthMode) {
                    this.highBandwidthMode = true
                    if (isDev) console.log('[P2PEngine] High Bandwidth Detected (>10MB/s). Unlocking higher upload limits.')
                }
            }

            // Periodically Re-evaluate Upload Limits (Every 30s)
            const now = Date.now()
            if (now - this.lastLimitUpdate > 30000) {
                this.updateDynamicLimits()
                this.lastLimitUpdate = now
            }

            // Network Change Monitor (Every ~10s)
            // We check this less frequently to avoid overhead
            if (now % 10000 < 2000) { // Check roughly every 10s
                const currentFingerprint = this._getNetworkFingerprint()
                if (this.lastNetworkFingerprint && currentFingerprint !== this.lastNetworkFingerprint) {
                    console.log('[P2PEngine] Network interface change detected! Restarting Swarm...')
                    this.lastNetworkFingerprint = currentFingerprint

                    // Restart logic
                    this.stop().then(() => {
                        // Small delay to let OS settle
                        setTimeout(() => this.start(), 2000)
                    })
                } else if (!this.lastNetworkFingerprint) {
                    this.lastNetworkFingerprint = currentFingerprint
                }
            }

            // Seeder Health Consensus (The Doctor) - Every 30s
            if (now - (this.lastHealthCheck || 0) > 30000) {
                this.checkSeederHealth()
                this.lastHealthCheck = now
            }

        }, 2000)
    }

    setRaceManager(rm) {
        this.raceManager = rm
    }

    async start() {
        if (!ConfigManager.getGlobalOptimization()) {
            // console.log('[P2PEngine] Global Optimization Disabled. Not starting.')
            this.stop()
            return
        }

        if (this.swarm || this.starting) return // Already running or starting

        this.starting = true
        this.stopping = false
        try {
            await PeerPersistence.load()
            await this.init()
        } finally {
            this.starting = false
        }

        // Pre-warming: Add known peers to DHT routing table immediately
        const knownPeers = PeerPersistence.getPeers('global')
        if (knownPeers.length > 0) {
            console.log(`[P2PEngine] Pre-warming: Adding ${knownPeers.length} persistent peers to DHT...`)
            for (const p of knownPeers) {
                try {
                    let ip = p.ip
                    if (!ip || typeof ip !== 'string') continue

                    // Unmap IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
                    if (ip.startsWith('::ffff:')) {
                        ip = ip.substring(7)
                    }

                    if (this.dht) {
                        // dht-rpc's addNode/id only supports IPv4 strings presently
                        // Skip if it still looks like an IPv6 address
                        if (ip.includes(':')) continue

                        this.dht.addNode({ host: ip, port: p.port })
                    }
                } catch (e) {
                    console.warn(`[P2PEngine] Failed to add persistent node ${p.ip}:${p.port} to DHT:`, e.message)
                }
            }
        }

        this.reconfigureSwarm()
    }

    async stop() {
        this.starting = false
        this.stopping = true
        if (this.swarm) {
            // console.log('[P2PEngine] Stopping...')
            const swarm = this.swarm
            this.swarm = null // Nullify immediately to prevent new operations
            this.peers = [] // Clear peers immediately
            try {
                await swarm.destroy()
            } catch (e) {
                // Ignore errors during destroy
            }
        }
        this.stopping = false
    }

    isLocalIP(ip) {
        if (!ip) return false
        if (ip.startsWith('::ffff:')) ip = ip.substring(7)

        // Comprehensive Local Check (Regex optimized for common ranges)
        // Includes: 127.0.0.1, 192.168.x.x, 10.x.x.x, 172.16-31.x.x, 169.254.x.x (APIPA)
        // Also: 100.64.0.0/10 (CGNAT/VPN), fe80:: (IPv6 LL), ::1 (IPv6 Loopback)
        return /^(127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.|fe80::|::1$)/.test(ip) || ip === '::1'
    }

    async init() {
        try {
            if (Config.BOOTSTRAP_URL) {
                try {
                    const res = await fetch(Config.BOOTSTRAP_URL)
                    if (res.ok) {
                        const remoteNodes = await res.json()
                        if (Array.isArray(remoteNodes) && remoteNodes.length > 0) {
                            Config.BOOTSTRAP_NODES = remoteNodes
                            // console.log('[P2PEngine] Updated bootstrap nodes from remote source.')
                        }
                    }
                } catch (e) {
                    // console.warn('[P2PEngine] Failed to fetch remote bootstrap nodes, using fallback.')
                }
            }

            this.dht = new HyperDHT({
                ephemeral: false,
                bootstrap: Config.BOOTSTRAP_NODES.map(n => ({
                    host: n.host,
                    port: n.port,
                    publicKey: n.publicKey ? b4a.from(n.publicKey, 'hex') : undefined
                }))
            })

            this.dht.on('error', (err) => {
                // console.error('[P2PEngine] HyperDHT Error:', err)
            })

            if (isDev) {
                /*
                this.dht.on('node', (node) => {
                    console.debug(`[P2P Debug] DHT Node connected: ${node.host}:${node.port}`)
                })
                this.dht.on('warning', (err) => {
                    console.debug(`[P2P Debug] DHT Warning:`, err.message)
                })
                */
            }

            this.dht.on('ready', () => {
                const nodesCount = this._getRoutingTableSize()
                if (isDev) {
                    console.debug(`[P2P Debug] DHT Ready. Bootstrapped: ${this.dht.bootstrapped}. Routing Nodes: ${nodesCount}`)
                    /*
                    // Deep inspect
                    try {
                        const internals = {
                            bootstraps: this.dht.io?.clientSocket?.unref ? 'UDP Socket Active' : 'Unknown',
                            concurrency: this.dht.concurrency,
                            kbucket: this.dht.kbucket?.count()
                        }
                        console.debug('[P2P Debug] DHT Internals:', internals)
                    } catch (e) {
                        console.debug('[P2P Debug] Inspection error', e)
                    }
                    */
                }

                setTimeout(() => {
                    const currentNodes = this._getRoutingTableSize()
                    // if (isDev) console.debug(`[P2P Debug] DHT Status after 5s. Bootstrapped: ${this.dht.bootstrapped}. Routing Nodes: ${currentNodes}`)
                    if (currentNodes === 0 && !this.dht.bootstrapped) {
                        console.warn(`[P2PEngine] [WARNING] No DHT connections established after 5s.`)
                    }
                }, 5000)
            })

            this.swarm = new Hyperswarm({
                dht: this.dht,
                local: true,
                mdns: true,
                maxPeers: this.profile.maxPeers * 2 // Give extra slots for local peers
            })

            this.swarm.on('connection', (socket, info) => {
                const peer = new PeerHandler(socket, this, info)

                let ip = (info.peer && info.peer.host) || socket.remoteAddress || (socket.rawStream && socket.rawStream.remoteAddress) || 'unknown'
                if (ip.startsWith('::ffff:')) ip = ip.substring(7)

                const peerId = peer.getID()
                if (this.blacklist.has(peerId)) {
                    if (isDev) console.warn(`[P2P Security] Rejecting blacklisted peer: ${peerId}`)
                    socket.destroy()
                    return
                }

                const isLocal = this.isLocalIP(ip)
                const type = isLocal ? 'LOCAL (LAN)' : 'GLOBAL (WAN)'
                const peerInfoStr = info.peer ? `${info.peer.host}:${info.peer.port}` : 'unknown'

                if (isDev && ip === 'unknown') {
                    // Only log WAN peers or unknown in debug, LAN is too noisy
                    // console.log(`%c[P2PEngine] Connection Established: [${type}] ${ip} (Remote: ${peerInfoStr})`, 'color: #00ff00; font-weight: bold')
                }

                /*
                if (isDev) {
                    console.debug(`[P2P Debug] Peer added. CID: ${b4a.toString(info.publicKey, 'hex').substring(0, 8)}. Type: ${type}`)
                }
                */

                if (this.peers.length > this.profile.maxPeers) {
                    if (isDev) console.debug(`[P2P Debug] Rejecting connection: Max peers reached (${this.profile.maxPeers})`)
                    socket.destroy()
                    return
                }

                // Increase listeners for high-concurrency requests (e.g. music streaming)
                socket.setMaxListeners(100)

                this.peers.push(peer)
                this.emit('peer_added', peer)
            })

            // Join the topic
            const shouldAnnounce = !this.profile.passive && !NodeAdapter.isCritical() && (ConfigManager.getP2PUploadEnabled() || ConfigManager.getLocalOptimization())

            const discovery = this.swarm.join(SWARM_TOPIC, {
                server: shouldAnnounce,
                client: true
            })

            // Initialize Global Rate Limiter
            if (ConfigManager.getP2PUploadEnabled()) {
                const limitMbps = ConfigManager.getP2PUploadLimit()
                // RateLimiter is a singleton, so we set it once here
                const RateLimiter = require('../app/assets/js/core/util/RateLimiter')
                RateLimiter.update(limitMbps * 125000, true)
            }

            await discovery.flushed()
            console.log(`[P2PEngine] P2P Service Started. Debug Mode: ${isDev}`)
            // console.log(`[P2PEngine] Active Data Directory: ${ConfigManager.getDataDirectory()}`)
            // console.log(`[P2PEngine] Active Common Directory: ${ConfigManager.getCommonDirectory()}`)
            if (isDev) {
                // console.debug(`[P2P Debug] Extended Debug Info...`)
            }
            if (shouldAnnounce) {
                if (ConfigManager.getLocalOptimization()) console.log(`[P2PEngine] Local Network: Active (Announcing via MDNS)`)
                if (ConfigManager.getP2PUploadEnabled()) console.log(`[P2PEngine] Global Network: Active (Announcing via DHT)`)
                else console.log(`[P2PEngine] Global Network: Downloads Only (Upload Disabled)`)
            } else {
                console.log(`[P2PEngine] Passive Mode (Client Only - Not Announcing)`)
            }

        } catch (err) {
            console.error('[P2PEngine] Init failed:', err)
        }
    }

    getLoadStatus() {
        if (!this.swarm || this.peers.length === 0) return 'offline'
        const reqs = this.requests.size
        const peers = this.peers.length

        // "Ambition Control"
        // If we have very few peers (e.g. 1), we shouldn't pile on too many requests.
        // Ratio: 3 requests per peer is "Busy", 6 is "Overloaded" (Allow more deep queue for single peer)
        if (reqs > peers * 6) return 'overloaded'
        if (reqs > peers * 3) return 'busy'
        return 'ok'
    }

    getOptimalConcurrency(defaultLimit = 32) {
        if (!this.swarm || this.peers.length === 0) return defaultLimit
        // "Calculate strength": 6 threads per peer, clamped between 6 and defaultLimit
        return Math.max(6, Math.min(defaultLimit, this.peers.length * 6))
    }

    requestFile(hash, expectedSize = 0, relPath = null, fileId = null, startOffset = 0) {
        // if (isDev) console.debug(`[P2P Debug] requestFile called for ${hash.substring(0, 8)} (${fileId || 'n/a'}) Offset: ${startOffset}`)
        const stream = new Readable({
            read() { }
        })

        // Use a persistent task to handle the request (allows waiting for peers)
        this._handleRequestAsync(stream, hash, expectedSize, relPath, fileId, startOffset).catch(err => {
            if (!stream.destroyed) stream.emit('error', err)
        })

        return stream
    }

    async _handleRequestAsync(stream, hash, expectedSize, relPath, fileId, startOffset) {
        const attemptedPeers = new Set()

        // Dynamic retry limit: Try at least 10 times or all available peers
        const getMaxAttempts = () => Math.max(10, this.peers.length + 2)

        for (let i = 0; i < getMaxAttempts(); i++) {
            // Check for peers & Wait if needed
            if (this.peers.length === 0) {
                if (isDev && !this.discoveryLogThrottled) {
                    // console.debug(`[P2P] No peers available. Starting discovery wait...`)
                    this.discoveryLogThrottled = true
                }

                if (!this._discoveryPromise) {
                    this._discoveryPromise = new Promise(resolve => {
                        const onConn = () => { this.off('peer_added', onConn); clearTimeout(t); this._discoveryPromise = null; resolve(true) }
                        const t = setTimeout(() => { this.off('peer_added', onConn); this._discoveryPromise = null; resolve(false) }, 10000)
                        this.once('peer_added', onConn)
                    })
                }
                await this._discoveryPromise
            }

            if (this.peers.length === 0) {
                if (i >= 2) { // Give a few chances for discovery
                    stream.emit('error', new Error('No peers available after discovery wait'))
                    return
                }
                continue
            }

            // Select Best Peer among those not yet tried
            let bestPeer = null
            let maxScore = -1

            const availablePeers = this.peers.filter(p => !attemptedPeers.has(p))

            if (availablePeers.length === 0) {
                // If we've tried everyone and failed, but still have attempts left,
                // we might want to wait a bit for new peers or just fail.
                // if (isDev) console.debug(`[P2P] All ${attemptedPeers.size} available peers already tried.`)
                stream.emit('error', new Error('All available peers failed'))
                return
            }

            for (const p of availablePeers) {
                const weight = p.remoteWeight || 1
                const rtt = p.rtt || 200
                let speedFactor = 1.0
                if (p.lastTransferSpeed) {
                    speedFactor = Math.max(0.1, p.lastTransferSpeed / 102400)
                    speedFactor = Math.min(10.0, speedFactor)
                }
                let lanFactor = p.isLocal() ? 100.0 : 1.0

                const score = (weight * weight) * (10000 / (rtt + 10)) * speedFactor * lanFactor
                if (score > maxScore) {
                    maxScore = score
                    bestPeer = p
                }
            }

            if (!bestPeer) {
                stream.emit('error', new Error('Peer selection failed'))
                return
            }

            attemptedPeers.add(bestPeer)

            try {
                await this._executeSingleRequest(bestPeer, stream, hash, expectedSize, relPath, fileId, startOffset)
                return // Success
            } catch (err) {
                // If some data was sent, we HAVE to fail the stream because DownloadEngine needs to reset the file.
                if (err.bytesReceived > 0) {
                    if (isDev) console.error(`[P2PEngine] Mid-transfer failure from ${bestPeer.getID()} (${err.bytesReceived} bytes): ${err.message}`)
                    // Only penalize if it was a security limit violation (malicious)
                    const isMalicious = err.message.includes('security limit')
                    this.penalizePeer(bestPeer, isMalicious)
                    stream.emit('error', err)
                    return
                }

                if (isDev && !err.message.includes('Timeout') && !err.message.includes('Not Found')) {
                    console.warn(`[P2PEngine] Peer ${bestPeer.getIP()} failed for ${hash.substring(0, 8)}. Trying next... (${err.message})`)
                }

                // If it was a "Not Found" or "Busy", we just continue the loop to the next peer.
                // Small sleep to avoid instant hammering
                await new Promise(r => setTimeout(r, 200))
            }
        }

        stream.emit('error', new Error('Download failed after exhausted peer list'))
    }

    _executeSingleRequest(peer, stream, hash, expectedSize, relPath, fileId, startOffset = 0) {
        return new Promise((resolve, reject) => {
            // VULNERABILITY FIX: Hard Cap mechanisms for Requests Map
            // Prevent Memory Leak / Explosion via API abuse
            if (this.requests.size >= 500) {
                reject(new Error('P2P Engine Overloaded (Request Cap Reached)'))
                return
            }

            // Generate Random Request ID (collision avoidance)
            let reqId
            do {
                reqId = crypto.randomBytes(4).readUInt32BE(0)
            } while (this.requests.has(reqId) || reqId === 0)

            // if (isDev) console.debug(`[P2P Debug] Requesting ${hash.substring(0, 8)} (${fileId || 'n/a'}) from ${peer.getIP()} [${peer.isLocal() ? 'LAN' : 'WAN'}]`)

            // Register Request
            this.requests.set(reqId, {
                stream,
                peer,
                expectedSize,
                timestamp: Date.now(),
                bytesReceived: startOffset, // Initialize with offset so size checks are correct
                resolve,
                reject
            })

            // Sending request
            const useBatching = peer.batchSupport && (expectedSize > 0 && expectedSize < 1024 * 1024) && !relPath

            if (useBatching) {
                if (!this.batchQueue.has(peer)) {
                    this.batchQueue.set(peer, [])
                }
                this.batchQueue.get(peer).push({ reqId, hash })

                if (!this.batchFlushScheduled) {
                    this.batchFlushScheduled = true
                    setTimeout(() => this.flushBatches(), 20)
                }
            } else {
                try {
                    peer.sendRequest(reqId, hash, relPath, fileId, startOffset)
                } catch (e) {
                    this.requests.delete(reqId)
                    reject(e)
                    return
                }
            }

            setTimeout(() => {
                if (this.requests.has(reqId)) {
                    const req = this.requests.get(reqId)
                    this.requests.delete(reqId)
                    const err = new Error('P2P Timeout')
                    err.bytesReceived = req.bytesReceived
                    req.reject(err)
                }
            }, Config.PROTOCOL.TIMEOUT)
        })
    }

    handleIncomingData(reqId, data, senderPeer) {
        // Strict Validation
        if (typeof reqId !== 'number' || !b4a.isBuffer(data)) return

        const req = this.requests.get(reqId)
        if (req) {
            // VULNERABILITY FIX 1: ReqID Spoofing Protection
            if (req.peer !== senderPeer) {
                return
            }

            req.bytesReceived = (req.bytesReceived || 0) + data.length

            if (req.peer.isLocal()) {
                this.totalDownloadedLocal += data.length
            } else {
                this.totalDownloadedGlobal += data.length
            }

            this.totalDownloaded += data.length

            // VULNERABILITY FIX ("Infinite File"): Size Check with Tolerance
            // We allow 1MB extra to account for minor file updates, metadata overhead, or network jitter.
            const tolerance = 1048576 // 1MB
            if (req.expectedSize > 0 && req.bytesReceived > (req.expectedSize + tolerance)) {
                if (isDev) console.error(`[P2P Security] Peer ${req.peer.getIP()} sent too many bytes! Received: ${req.bytesReceived}, Expected: ${req.expectedSize}`)
                const err = new Error('File size exceeded security limit')
                err.bytesReceived = req.bytesReceived
                return
            }

            // Track for Speed Monitor
            if (req.peer.isLocal()) {
                this.downloadBytesLocal += data.length
            } else {
                this.downloadBytesGlobal += data.length
            }

            req.stream.push(data)
        }
    }

    handleIncomingEnd(reqId, senderPeer) {
        const req = this.requests.get(reqId)
        if (req) {
            if (req.peer !== senderPeer) return;

            // Strict Size Validation
            if (req.expectedSize > 0 && req.bytesReceived !== req.expectedSize) {
                const err = new Error(`Incomplete transfer: Received ${req.bytesReceived} of ${req.expectedSize}`)
                err.bytesReceived = req.bytesReceived
                req.reject(err)
                this.requests.delete(reqId)
                return
            }

            req.stream.push(null) // EOF
            req.resolve()

            const duration = (Date.now() - req.timestamp) / 1000
            if (duration > 0 && req.bytesReceived > 102400) {
                const speed = req.bytesReceived / duration
                req.peer.lastTransferSpeed = speed
            }

            this.requests.delete(reqId)
        }
    }

    handleIncomingError(reqId, messageBuffer, senderPeer) {
        const req = this.requests.get(reqId)
        if (req) {
            if (req.peer !== senderPeer) return;

            const msg = messageBuffer.toString('utf-8')
            const err = new Error(`Peer error: ${msg}`)
            err.bytesReceived = req.bytesReceived
            req.reject(err)
            this.requests.delete(reqId)
        }
    }

    flushBatches() {
        this.batchFlushScheduled = false
        for (const [peer, initialRequests] of this.batchQueue) {
            if (peer.socket.destroyed || !this.peers.includes(peer)) {
                this.batchQueue.delete(peer)
                continue
            }

            let requests = initialRequests
            while (requests.length > 0) {
                const chunk = requests.slice(0, 50) // BATCH_SIZE_LIMIT
                requests = requests.slice(50)
                try {
                    peer.sendBatchRequest(chunk)
                } catch (e) {
                    console.error('[P2PEngine] Failed to send batch', e)
                }
            }
        }
        this.batchQueue.clear()
    }

    reportUploadStats(speed, isError) {
        if (!this.uploadHistory) this.uploadHistory = []

        if (isError) {
            const weight = NodeAdapter.penaltyWeight()
            if (isDev) console.warn(`[P2PEngine] Upload performance penalty applied. Current Weight: ${weight}`)

            if (NodeAdapter.isCritical()) {
                console.error('[P2PEngine] CRITICAL performance drop! Stopping announcement to preserve system resources.')
                this.reconfigureSwarm()
            }
            return
        }

        this.uploadHistory.push(speed)
        if (this.uploadHistory.length > 5) this.uploadHistory.shift()

        const avg = this.uploadHistory.reduce((a, b) => a + b, 0) / this.uploadHistory.length

        // Fix: Do not downgrade to LOW based on speed alone.
        // A "Slow" upload often means the RECEIVER is slow, not us.
        // We should rely on 'isRealFailure' penalties to handle broken nodes.
        if (avg > 1048576) { // > 1MB/s
            NodeAdapter.boostWeight()
        }
    }

    reconfigureSwarm() {
        if (!this.swarm || this.stopping || this.swarm.destroyed) return
        const topic = SWARM_TOPIC
        // If critical (game running) OR health check failed (passive mode), disable server announcement
        const isCritical = NodeAdapter.isCritical()
        const isSelfIsolated = this.healthCheckPassive

        const shouldAnnounce = !this.profile.passive && !isCritical && !isSelfIsolated && (ConfigManager.getP2PUploadEnabled() || ConfigManager.getLocalOptimization())

        if (isDev && isSelfIsolated) console.warn('[P2PEngine] Swarm Reconfigure: Self-Isolated (Passive Mode enforced)')

        // console.log(`[P2PEngine] Reconfiguring Swarm. Announcing: ${shouldAnnounce}`)
        this.swarm.join(topic, { client: true, server: shouldAnnounce })
    }

    penalizePeer(peer, isMalicious = true) {
        const id = peer.getID()
        if (id === 'unknown') {
            peer.socket.destroy()
            return
        }

        if (!isMalicious) {
            if (isDev) console.log(`[P2P] Disconnecting peer ${id} due to network issue (No penalty)`)
            peer.socket.destroy()
            return
        }

        const strikes = (this.peerStrikes.get(id) || 0) + 1

        // Memory Guard: Cap strike tracker
        if (this.peerStrikes.size > 2000) {
            const firstKey = this.peerStrikes.keys().next().value
            this.peerStrikes.delete(firstKey)
        }

        this.peerStrikes.set(id, strikes)

        if (isDev) console.warn(`[P2P Security] Penalizing peer ${id}. Strikes: ${strikes}/3`)

        if (strikes >= 3) {
            console.error(`[P2P Security] BLACKLISTING ID: ${id} for suspicious behavior.`)
            this.blacklist.add(id)
            // Remove blacklist after 10 minutes
            setTimeout(() => this.blacklist.delete(id), 600000)
        }

        // Always disconnect the peer on a strike
        peer.socket.destroy()
    }

    triggerCircuitBreaker() {
        if (this.panicMode) return
        this.attackCounter++

        if (this.attackCounter >= 5) { // Increased threshold for global panic
            console.error('[P2PEngine] GLOBAL CIRCUIT BREAKER TRIGGERED! Stopping P2P temporarily.')

            this.panicMode = true
            this.stop()
            setTimeout(() => {
                this.panicMode = false
                this.attackCounter = 0
                this.start()
            }, 300000)
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
        const candidates = [
            this.dht.nodes,
            this.dht.routingTable,
            this.dht.table,
            this.dht._dht?.nodes,
            this.dht.kbucket
        ]

        for (const table of candidates) {
            if (!table) continue
            if (typeof table.size === 'number') return table.size
            if (Array.isArray(table)) return table.length
            if (typeof table.count === 'function') return table.count()
            if (typeof table.toArray === 'function') return table.toArray().length
            if (typeof table.length === 'number') return table.length
        }
        return 0
    }

    queueRequest(peer, reqId, hash, relPath, fileId, startOffset = 0) {
        if (!this.serverQueue) this.serverQueue = []

        // Max Queue Size Protection (DoS)
        if (this.serverQueue.length > 500) {
            peer.sendError(reqId, 'Server Busy (Queue Full)')
            return
        }

        this.serverQueue.push({ peer, reqId, hash, relPath, fileId, startOffset, timestamp: Date.now() })
        this.processServerQueue()
    }

    processServerQueue() {
        if (!this.serverQueue || this.serverQueue.length === 0) return

        const { MAX_CONCURRENT_UPLOADS } = require('./constants')
        const max = MAX_CONCURRENT_UPLOADS || 5

        while (this.activeUploads < max && this.serverQueue.length > 0) {
            const req = this.serverQueue.shift()
            // Check if peer is still alive
            if (req.peer.socket.destroyed) continue

            // Check if request is stale (> 30s)
            if (Date.now() - req.timestamp > 30000) continue

            // Execute
            req.peer.executeRequest(req.reqId, req.hash, req.relPath, req.fileId, req.startOffset)
        }
    }

    onUploadFinished() {
        this.processServerQueue()
    }

    pruneQueue(peer) {
        if (!this.serverQueue || this.serverQueue.length === 0) return

        const initialSize = this.serverQueue.length
        this.serverQueue = this.serverQueue.filter(req => req.peer !== peer)

        // if (isDev && this.serverQueue.length < initialSize) {
        //    console.debug(`[P2PEngine] Pruned ${initialSize - this.serverQueue.length} zombie requests from queue for ${peer.getIP()}`)
        // }
    }

    getOptimalConcurrency(baseLimit) {
        const { MIN_PARALLEL_DOWNLOADS, MAX_PARALLEL_DOWNLOADS, PEER_CONCURRENCY_FACTOR } = require('./constants')
        const ResourceMonitor = require('./ResourceMonitor')

        // ensure initialized
        ResourceMonitor.start()

        const peerCount = this.peers.length

        // 1. Peer-based Scaling
        let dynamic = baseLimit
        if (peerCount > 0) {
            dynamic = Math.max(MIN_PARALLEL_DOWNLOADS, peerCount * PEER_CONCURRENCY_FACTOR)
        }

        // 2. CPU-based Throttling (Dynamic Concurrency)
        const cpuUsage = ResourceMonitor.getCPUUsage() // 0-100
        let stressLimit = MAX_PARALLEL_DOWNLOADS

        if (cpuUsage > 90) {
            stressLimit = 8 // CRITICAL STRESS -> Min
        } else if (cpuUsage > 70) {
            // Linear scaling from 70% (32) to 90% (8) approx
            // But simpler: Drop to 16
            stressLimit = 16
        } else if (cpuUsage > 50) {
            stressLimit = 24
        }

        // 3. Network Load Throttling (Ambition Control)
        const loadStatus = this.getLoadStatus()
        if (loadStatus === 'overloaded') {
            stressLimit = Math.min(stressLimit, 12)
        }

        // Final Calculation: Min of PeerCap and StressCap, but never below Absolute Min
        const final = Math.min(dynamic, stressLimit)

        return Math.max(MIN_PARALLEL_DOWNLOADS, Math.min(MAX_PARALLEL_DOWNLOADS, final))
    }

    getLoadStatus() {
        // Simple heuristic: if we have many active requests relative to peer count
        if (this.peers.length === 0) return 'idle'

        // If we-re already downloading many files, consider it "busy" but not overloaded
        // unless we hit a very high threshold.
        const ratio = this.requests.size / Math.max(1, this.peers.length)
        if (ratio > 10) return 'overloaded'
        if (ratio > 5) return 'busy'
        return 'normal'
    }

    getNetworkInfo() {
        if (!this.totalUploaded) this.totalUploaded = 0
        const routingNodes = this._getRoutingTableSize()

        const isEffectivelyPassive = this.profile.passive || !ConfigManager.getP2PUploadEnabled() || NodeAdapter.isCritical()

        const localPeers = this.peers.filter(p => {
            const ip = p.socket.remoteAddress || p.info?.peer?.host || (p.socket.rawStream && p.socket.rawStream.remoteAddress)
            return this.isLocalIP(ip)
        }).length
        const globalPeers = Math.max(0, this.peers.length - localPeers)

        return {
            peers: this.peers.length,
            localPeers,
            globalPeers,
            topic: SWARM_TOPIC.toString('hex').substring(0, 8),
            requests: this.requests.size,
            // queue: this.serverQueue ? this.serverQueue.length : 0, // Helpful metric
            uploads: this.activeUploads,
            uploaded: this.totalUploaded,
            uploadedLocal: this.totalUploadedLocal || 0,
            uploadedGlobal: this.totalUploadedGlobal || 0,
            downloaded: this.totalDownloaded || 0,
            downloadedLocal: this.totalDownloadedLocal || 0,
            downloadedGlobal: this.totalDownloadedGlobal || 0,
            dhtNodes: routingNodes,
            bootstrapNodes: Config.BOOTSTRAP_NODES.length,
            bootstrapped: this.dht && this.dht.bootstrapped,
            running: !!this.swarm,
            listening: !!this.swarm, // Added for UI compatibility
            mode: isEffectivelyPassive ? 'Passive (Leech)' : 'Active (Seed)',
            profile: this.profile.name,
            downloadSpeed: this.currentDownloadSpeed || 0,
            uploadSpeed: this.currentUploadSpeed || 0,
            downloadSpeedLocal: this.currentDownloadSpeedLocal || 0,
            uploadSpeedLocal: this.currentUploadSpeedLocal || 0
        }
    }

    removePeer(peer) {
        // Prune any pending server requests from this peer (DoS protection)
        this.pruneQueue(peer)

        // Clear batch queue
        if (this.batchQueue.has(peer)) {
            this.batchQueue.delete(peer)
        }

        const idx = this.peers.indexOf(peer)
        if (idx > -1) this.peers.splice(idx, 1)

        this.emit('peer_removed', peer)
    }


    updateDynamicLimits() {
        if (!ConfigManager.isLoaded()) return
        if (!ConfigManager.getP2PUploadEnabled()) return

        // 1. Resource Check
        // Only MID and HIGH profiles (sufficient RAM/CPU) are eligible for boost
        const profile = this.profile
        const canBoost = (profile.name === 'MID' || profile.name === 'HIGH')

        // 2. Bandwidth Check
        // Must have proven high bandwidth capacity
        const hasBandwidth = this.highBandwidthMode

        // 3. System Load Check
        // Ensure system isn't currently overwhelmed
        const load = os.loadavg() // [1min, 5min, 15min]
        const cpus = os.cpus().length
        // If 1-min load avg > CPU count * 0.8, we are under stress
        const isStressed = load[0] > (cpus * 0.8)

        let newLimitMbps = 5 // Default Safe Limit

        if (canBoost && hasBandwidth && !isStressed) {
            newLimitMbps = 15 // Boost Mode
        } else {
            // If downgrading, log reason for debugging
            if (canBoost && hasBandwidth && isStressed) {
                if (isDev) console.warn(`[P2PEngine] System stressed (Load: ${load[0].toFixed(2)}). Downgrading upload limit.`)
            }
        }

        // Apply Limit
        const RateLimiter = require('../app/assets/js/core/util/RateLimiter')
        RateLimiter.update(newLimitMbps * 125000, true)

        // if (isDev) console.debug(`[P2PEngine] Dynamic Upload Limit set to ${newLimitMbps} Mbps`)
    }
    checkSeederHealth() {
        // If we are already self-isolated, check if it's time to recover
        if (this.healthCheckPassive) {
            if (Date.now() - this.healthCheckPassiveStart > 3600000) { // 1 Hour
                console.log('[P2PEngine] Health Check: Probation period ended. Re-enabling active mode.')
                this.healthCheckPassive = false
                this.selfStrikes = 0
                this.reconfigureSwarm()
            }
            return
        }

        // Logic: "Consensus of Failure"
        // 1. "3 Witnesses" Rule: Must have significant load to judge (at least 3 active upload peers)
        const activeUploadPeers = this.peers.filter(p => p.currentTransferSpeed > 0)

        if (activeUploadPeers.length < 3) {
            // Not enough witnesses to judge "Consensus"
            // Decay strikes to be forgiving if load drops
            if (this.selfStrikes > 0) this.selfStrikes--
            return
        }

        const fastPeers = activeUploadPeers.filter(p => p.currentTransferSpeed > 512000) // > 500 KB/s
        const slowPeers = activeUploadPeers.filter(p => p.currentTransferSpeed < 128000) // < 125 KB/s

        // "I am fine" check: If at least one peer is fast, my upload is fine.
        if (fastPeers.length > 0) {
            this.selfStrikes = 0
            return
        }

        // "It's me" check: If ALL peers are slow.
        if (slowPeers.length === activeUploadPeers.length) {
            this.selfStrikes = (this.selfStrikes || 0) + 1
            console.warn(`[P2PEngine] Health Check: Warning! ${activeUploadPeers.length}/${activeUploadPeers.length} peers are slow. Self-Strike ${this.selfStrikes}/3.`)

            if (this.selfStrikes >= 3) {
                console.error(`[P2PEngine] Health Check: CONSENSUS OF FAILURE (3 Strikes). Self-isolating to protect Swarm.`)
                this.healthCheckPassive = true
                this.healthCheckPassiveStart = Date.now()
                this.reconfigureSwarm()
            }
        } else {
            // Mixed results (some medium speed, some slow) - Give benefit of doubt, decrement strike
            if (this.selfStrikes > 0) this.selfStrikes--
        }
    }

    _getNetworkFingerprint() {
        const interfaces = os.networkInterfaces()
        let fingerprint = ''
        // Sort keys to ensure stability
        const sortedKeys = Object.keys(interfaces).sort()
        for (const key of sortedKeys) {
            const iface = interfaces[key]
            for (const details of iface) {
                // We care about address and status (implied by existence)
                // We ignore 'internal' loopback for fingerprinting usually, but for P2P restart it might matter if ONLY loopback exists.
                if (!details.internal && (details.family === 'IPv4' || details.family === 4)) {
                    fingerprint += `${key}:${details.address}|`
                }
            }
        }
        return fingerprint
    }
}

module.exports = new P2PEngine()
