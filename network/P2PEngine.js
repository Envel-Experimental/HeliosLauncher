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

// Fixed topic for the "Zombie" network
const { SWARM_TOPIC_SEED } = require('./constants')

// Fixed topic for the "Zombie" network
const SWARM_TOPIC = crypto.createHash('sha256').update(SWARM_TOPIC_SEED).digest()

class P2PEngine extends EventEmitter {
    constructor() {
        super()
        this.peers = [] // Array of PeerHandler
        this.requests = new Map() // reqId -> { stream: Readable, timeout: Timer }
        this.reqIdCounter = 1
        this.profile = NodeAdapter.getProfile()
        this.activeUploads = 0
        this.uploadCounts = new Map() // IP -> Count

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
        if (this.swarm) {
            this.reconfigureSwarm()
            return
        }
        await this.init()
    }

    async stop() {
        if (this.swarm) {
            // console.log('[P2PEngine] Stopping...')
            await this.swarm.destroy()
            this.swarm = null
            this.peers = []
        }
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

            this.dht.on('ready', () => {
                // const nodesCount = this.dht.nodes ? this.dht.nodes.count() : 0
                // console.log('[P2PEngine] HyperDHT Ready. Nodes in Table:', nodesCount)

                setTimeout(() => {
                    const currentNodes = this._getRoutingTableSize()
                    if (currentNodes === 0 && !this.dht.bootstrapped) {
                        console.warn(`[P2PEngine] [WARNING] No DHT connections established after 5s.`)
                    }
                }, 5000)
            })

            this.swarm = new Hyperswarm({ dht: this.dht, local: true, mdns: true })

            this.swarm.on('connection', (socket, info) => {
                const peer = new PeerHandler(socket, this)
                this.peers.push(peer)
                // console.log(`[P2PEngine] Connected to peer: ${info.publicKey.toString('hex').substring(0, 8)}...`)

                if (this.peers.length > this.profile.maxPeers) {
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

            await discovery.flushed()
            // console.log(`[P2PEngine] Initialized. Passive: ${isPassive}`)

        } catch (err) {
            console.error('[P2PEngine] Init failed:', err)
        }
    }

    requestFile(hash, expectedSize = 0) {
        const stream = new Readable({
            read() { }
        })

        if (this.peers.length === 0) {
            process.nextTick(() => {
                stream.emit('error', new Error('No peers available'))
            })
            return stream
        }

        const reqId = this.reqIdCounter++
        if (this.reqIdCounter > 4294967295) this.reqIdCounter = 1

        let bestPeer = null
        let maxScore = -1

        if (this.peers.length > 0) {
            for (const p of this.peers) {
                const weight = p.remoteWeight || 1
                const rtt = p.rtt || 200

                let speedFactor = 1.0
                if (p.lastTransferSpeed) {
                    speedFactor = Math.max(0.1, p.lastTransferSpeed / 102400)
                    speedFactor = Math.min(10.0, speedFactor)
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
            timestamp: Date.now(),
            bytesReceived: 0
        })

        const useBatching = peer.batchSupport && (expectedSize > 0 && expectedSize < 1024 * 1024)

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
            peer.sendRequest(reqId, hash)
        }

        stream.on('close', () => {
            if (this.requests.has(reqId)) {
                this.requests.delete(reqId)
            }
        })

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
                return
            }

            req.bytesReceived = (req.bytesReceived || 0) + data.length

            // VULNERABILITY FIX ("Infinite File"): Size Check
            if (req.expectedSize > 0 && req.bytesReceived > req.expectedSize) {
                req.stream.emit('error', new Error('File size exceeded expected limit'))
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

            req.stream.push(null) // EOF

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
            req.stream.emit('error', new Error(`Peer error: ${msg}`))
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
        const isPassive = this.profile.passive || NodeAdapter.isCritical() || !ConfigManager.getP2PUploadEnabled()
        // console.log(`[P2PEngine] Reconfiguring Swarm. Passive: ${isPassive}`)
        this.swarm.join(topic, { client: true, server: !isPassive })
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

    removePeer(peer) {
        const idx = this.peers.indexOf(peer)
        if (idx > -1) this.peers.splice(idx, 1)
    }
}

module.exports = new P2PEngine()
