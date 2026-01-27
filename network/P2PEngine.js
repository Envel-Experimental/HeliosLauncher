const Hyperswarm = require('hyperswarm')
const HyperDHT = require('hyperdht')
const b4a = require('b4a')
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

class P2PEngine extends EventEmitter {
    constructor() {
        super()
        this.peers = [] // Array of PeerHandler
        this.requests = new Map() // reqId -> { stream: Readable, timeout: Timer }
        this.reqIdCounter = 1
        this.setMaxListeners(100)

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

        if (this.swarm) return // Already running

        await PeerPersistence.load()
        await this.init()

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
        if (this.swarm) {
            // console.log('[P2PEngine] Stopping...')
            await this.swarm.destroy()
            this.swarm = null
            this.peers = []
        }
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
                this.dht.on('node', (node) => {
                    console.debug(`[P2P Debug] DHT Node connected: ${node.host}:${node.port}`)
                })
                this.dht.on('warning', (err) => {
                    console.debug(`[P2P Debug] DHT Warning:`, err.message)
                })
            }

            this.dht.on('ready', () => {
                const nodesCount = this._getRoutingTableSize()
                if (isDev) {
                    console.debug(`[P2P Debug] DHT Ready. Bootstrapped: ${this.dht.bootstrapped}. Routing Nodes: ${nodesCount}`)
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
                }

                setTimeout(() => {
                    const currentNodes = this._getRoutingTableSize()
                    if (isDev) console.debug(`[P2P Debug] DHT Status after 5s. Bootstrapped: ${this.dht.bootstrapped}. Routing Nodes: ${currentNodes}`)
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
                this.peers.push(peer)
                this.emit('peer_added', peer)

                let ip = (info.peer && info.peer.host) || socket.remoteAddress || (socket.rawStream && socket.rawStream.remoteAddress) || 'unknown'
                if (ip.startsWith('::ffff:')) ip = ip.substring(7)

                const isLocal = this.isLocalIP(ip)
                const type = isLocal ? 'LOCAL (LAN)' : 'GLOBAL (WAN)'
                const peerInfoStr = info.peer ? `${info.peer.host}:${info.peer.port}` : 'unknown'

                if (ip === 'unknown' || isDev) {
                    console.log(`%c[P2PEngine] Connection Established: [${type}] ${ip} (Remote: ${peerInfoStr})`, 'color: #00ff00; font-weight: bold')
                }

                if (isDev) {
                    console.debug(`[P2P Debug] Peer added. CID: ${b4a.toString(info.publicKey, 'hex').substring(0, 8)}. Type: ${type}`)
                    if (ip === 'unknown') {
                        console.debug(`[P2P Debug] Full Connection Info for unknown:`, {
                            peer: info.peer,
                            client: info.client,
                            proven: info.proven,
                            local: info.local
                        })
                    }
                }

                if (this.peers.length > this.profile.maxPeers) {
                    if (isDev) console.debug(`[P2P Debug] Rejecting connection: Max peers reached (${this.profile.maxPeers})`)
                    socket.destroy()
                    return
                }

                // PeerHandler handles 'close' and calls removePeer
            })

            // Join the topic
            const shouldAnnounce = !this.profile.passive && !NodeAdapter.isCritical() && (ConfigManager.getP2PUploadEnabled() || ConfigManager.getLocalOptimization())

            const discovery = this.swarm.join(SWARM_TOPIC, {
                server: shouldAnnounce,
                client: true
            })

            await discovery.flushed()
            console.log(`[P2PEngine] P2P Service Started. Debug Mode: ${isDev}`)
            if (isDev) {
                console.debug(`[P2P Debug] Active Data Directory: ${ConfigManager.getDataDirectory()}`)
                console.debug(`[P2P Debug] Active Common Directory: ${ConfigManager.getCommonDirectory()}`)
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

    requestFile(hash, expectedSize = 0, relPath = null, fileId = null) {
        if (isDev) console.debug(`[P2P Debug] requestFile called for ${hash.substring(0, 8)} (${fileId || 'n/a'})`)
        const stream = new Readable({
            read() { }
        })

        // Use a persistent task to handle the request (allows waiting for peers)
        this._handleRequestAsync(stream, hash, expectedSize, relPath, fileId)

        return stream
    }

    async _handleRequestAsync(stream, hash, expectedSize, relPath, fileId) {
        const attempts = 5
        const attemptedPeers = new Set()

        for (let i = 0; i < attempts; i++) {
            // Check for peers & Wait if needed
            if (this.peers.length === 0) {
                if (isDev) console.debug(`[P2P] No peers. Waiting 10s... (Attempt ${i + 1}/${attempts})`)
                // Use existing discovery wait logic
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
                // If this is the last attempt, fail.
                if (i === attempts - 1) {
                    stream.emit('error', new Error('No peers available'))
                    return
                }
                continue
            }

            // Select Best Peer
            let bestPeer = null
            let maxScore = -1

            for (const p of this.peers) {
                if (attemptedPeers.has(p)) continue

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
                if (i === attempts - 1) {
                    stream.emit('error', new Error('Peer selection failed'))
                    return
                }
                continue
            }

            attemptedPeers.add(bestPeer)

            try {
                await this._executeSingleRequest(bestPeer, stream, hash, expectedSize, relPath, fileId)
                return // Success
            } catch (err) {
                // Check if fatal (data already sent)
                if (err.bytesReceived > 0) {
                    // console.error(`[P2PEngine] Fatal error from ${bestPeer.getIP()} after receiving ${err.bytesReceived} bytes: ${err.message}`)
                    stream.emit('error', err)
                    return
                }

                // console.warn(`[P2PEngine] Retryable error from ${bestPeer.getIP()}: ${err.message}`)
                // Loop continues
            }
        }

        stream.emit('error', new Error('Download failed after retries'))
    }

    _executeSingleRequest(peer, stream, hash, expectedSize, relPath, fileId) {
        return new Promise((resolve, reject) => {
            const reqId = this.reqIdCounter++
            if (this.reqIdCounter > 4294967295) this.reqIdCounter = 1

            if (isDev) console.debug(`[P2P Debug] Requesting ${hash.substring(0, 8)} (${fileId || 'n/a'}) from ${peer.getIP()} [${peer.isLocal() ? 'LAN' : 'WAN'}]`)

            // Register Request
            this.requests.set(reqId, {
                stream,
                peer,
                expectedSize,
                timestamp: Date.now(),
                bytesReceived: 0,
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
                    peer.sendRequest(reqId, hash, relPath, fileId)
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

            // VULNERABILITY FIX ("Infinite File"): Size Check
            if (req.expectedSize > 0 && req.bytesReceived > req.expectedSize) {
                const err = new Error('File size exceeded expected limit')
                err.bytesReceived = req.bytesReceived
                req.reject(err)
                this.requests.delete(reqId)
                this.triggerCircuitBreaker()
                return
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
        const shouldAnnounce = !this.profile.passive && !NodeAdapter.isCritical() && (ConfigManager.getP2PUploadEnabled() || ConfigManager.getLocalOptimization())
        // console.log(`[P2PEngine] Reconfiguring Swarm. Announcing: ${shouldAnnounce}`)
        this.swarm.join(topic, { client: true, server: shouldAnnounce })
    }

    triggerCircuitBreaker() {
        if (this.panicMode) return
        this.attackCounter++

        if (this.attackCounter >= 3) {
            console.error('[P2PEngine] CIRCUIT BREAKER TRIGGERED!')

            this.panicMode = true
            this.stop()

            setTimeout(() => {
                // console.log('[P2PEngine] Cooling down...')
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
            profile: this.profile.name
        }
    }

    removePeer(peer) {
        const idx = this.peers.indexOf(peer)
        if (idx > -1) this.peers.splice(idx, 1)
    }
}

module.exports = new P2PEngine()
