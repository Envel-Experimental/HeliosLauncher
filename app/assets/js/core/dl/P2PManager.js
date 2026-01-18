const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { LoggerUtil } = require('../util/LoggerUtil');
const ConfigManager = require('../../configmanager');

const logger = LoggerUtil.getLogger('P2PManager');

const DISCOVERY_PORT = 45565;
const DISCOVERY_MULTICAST_ADDR = '239.255.255.250';
const DISCOVERY_INTERVAL = 3000;
const PEER_TIMEOUT = 15000;

class P2PManager {
    constructor() {
        this.id = randomUUID();
        this.peers = new Map();
        this.httpServer = null;
        this.udpSocket = null;
        this.discoveryInterval = null;
        this.httpPort = 0;
        this.started = false;
        this.localAddress = null;
    }

    getBestLocalIP() {
        const interfaces = os.networkInterfaces();
        const candidates = [];

        for (const name of Object.keys(interfaces)) {
            const lowerName = name.toLowerCase();
            // Filter out virtual and VPN adapters
            if (lowerName.includes('vethernet') || 
                lowerName.includes('wsl') || 
                lowerName.includes('tap') || 
                lowerName.includes('tun') || 
                lowerName.includes('docker') ||
                lowerName.includes('virtual') ||
                lowerName.includes('vmware') ||
                lowerName.includes('pseudo')) {
                continue;
            }

            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    // Prioritize standard local networks
                    if (iface.address.startsWith('192.168.')) {
                        return iface.address;
                    }
                    candidates.push(iface.address);
                }
            }
        }
        return candidates.length > 0 ? candidates[0] : null;
    }

    start() {
        if (this.started) return;
        this.started = true;
        
        this.localAddress = this.getBestLocalIP();
        if (this.localAddress) {
            logger.info(`P2P Network Mode: Interface bound to ${this.localAddress}`);
        } else {
            logger.warn('P2P: Could not detect specific LAN interface, using default.');
        }

        this.startHttpServer();
        this.startDiscovery();
        logger.info('P2P Delivery Optimization started.');
    }

    startHttpServer() {
        this.httpServer = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });

        this.httpServer.maxConnections = 50;

        this.httpServer.on('error', (err) => {
            logger.warn('P2P HTTP Server error:', err);
        });

        this.httpServer.listen(0, '0.0.0.0', () => {
            this.httpPort = this.httpServer.address().port;
            logger.info(`P2P HTTP Server listening on port ${this.httpPort}`);
        });
    }

    handleRequest(req, res) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        if (url.pathname === '/file') {
            const hash = url.searchParams.get('hash');
            const relPath = url.searchParams.get('path');

            if (!hash || !relPath) {
                res.writeHead(400);
                res.end('Missing hash or path');
                return;
            }

            if (relPath.includes('..') || path.isAbsolute(relPath)) {
                res.writeHead(403);
                res.end('Invalid path');
                return;
            }

            const commonDir = ConfigManager.getCommonDirectory();
            const filePath = path.join(commonDir, relPath);
            const stream = fs.createReadStream(filePath);

            res.writeHead(200, {
                'Content-Type': 'application/octet-stream'
            });

            pipeline(stream, res).catch(err => {
                if (!res.headersSent) {
                    res.writeHead(404);
                    res.end('File not found');
                }
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    }

    startDiscovery() {
        this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this.udpSocket.on('error', (err) => {
            logger.warn('P2P Discovery error:', err);
            try { this.udpSocket.close(); } catch(e){}
        });

        this.udpSocket.on('message', (msg, rinfo) => {
            this.handleDiscoveryMessage(msg.toString(), rinfo);
        });

        this.udpSocket.bind(DISCOVERY_PORT, () => {
            try {
                if (this.localAddress) {
                    this.udpSocket.addMembership(DISCOVERY_MULTICAST_ADDR, this.localAddress);
                    this.udpSocket.setMulticastInterface(this.localAddress);
                } else {
                    this.udpSocket.addMembership(DISCOVERY_MULTICAST_ADDR);
                }
                
                this.udpSocket.setMulticastTTL(2);
                this.udpSocket.setBroadcast(true);
            } catch (err) {
                logger.warn('Failed to configure multicast:', err);
            }
            
            this.discoveryInterval = setInterval(() => {
                this.broadcastPresence();
                this.prunePeers();
            }, DISCOVERY_INTERVAL);
            
            this.broadcastPresence();
        });
    }

    broadcastPresence() {
        if (!this.httpPort) return;
        const message = Buffer.from(`HELIOS_P2P:v1:${this.id}:${this.httpPort}`);
        this.udpSocket.send(message, 0, message.length, DISCOVERY_PORT, DISCOVERY_MULTICAST_ADDR);
    }

    handleDiscoveryMessage(msg, rinfo) {
        if (!msg.startsWith('HELIOS_P2P:')) return;
        
        const parts = msg.split(':');
        if (parts.length < 4) return;

        const peerId = parts[2];
        const peerPort = parseInt(parts[3]);

        if (peerId === this.id) return;

        const peer = {
            id: peerId,
            ip: rinfo.address,
            port: peerPort,
            lastSeen: Date.now()
        };

        if (!this.peers.has(peerId)) {
            logger.info(`Found new peer: ${peer.ip}:${peer.port}`);
        }
        this.peers.set(peerId, peer);
    }

    prunePeers() {
        const now = Date.now();
        for (const [id, peer] of this.peers) {
            if (now - peer.lastSeen > PEER_TIMEOUT) {
                this.peers.delete(id);
            }
        }
    }

    async downloadFile(asset, destPath) {
        if (this.peers.size === 0) return false;

        const commonDir = ConfigManager.getCommonDirectory();
        let relPath = null;
        
        const absDestPath = path.resolve(destPath);
        const root = path.resolve(commonDir);

        if (absDestPath.startsWith(root)) {
            relPath = path.relative(root, absDestPath);
        } else {
            return false;
        }

        relPath = relPath.replace(/\\/g, '/');
        
        const peers = Array.from(this.peers.values());
        const peer = peers[Math.floor(Math.random() * peers.length)];
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        try {
            const url = `http://${peer.ip}:${peer.port}/file?hash=${asset.hash}&path=${encodeURIComponent(relPath)}`;
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const fileStream = fs.createWriteStream(destPath);
            
            if (Readable.fromWeb) {
                await pipeline(Readable.fromWeb(res.body), fileStream);
            } else {
                const reader = res.body.getReader();
                const nodeStream = new Readable({
                    async read() {
                        const { done, value } = await reader.read();
                        if (done) this.push(null);
                        else this.push(Buffer.from(value));
                    }
                });
                await pipeline(nodeStream, fileStream);
            }
            return true;

        } catch (err) {
            return false;
        }
    }
    
    stop() {
        if (this.httpServer) { this.httpServer.close(); this.httpServer = null; }
        if (this.udpSocket) { this.udpSocket.close(); this.udpSocket = null; }
        if (this.discoveryInterval) { clearInterval(this.discoveryInterval); this.discoveryInterval = null; }
        this.started = false;
    }
}

const instance = new P2PManager();
module.exports = instance;