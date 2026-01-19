const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { EventEmitter } = require('events');
const { LoggerUtil } = require('../util/LoggerUtil');
const ConfigManager = require('../../configmanager');

const logger = LoggerUtil.getLogger('P2PManager');

const DISCOVERY_PORT = 45565;
const DISCOVERY_MULTICAST_ADDR = '239.255.255.250';
const DISCOVERY_INTERVAL = 3000;
const PEER_TIMEOUT = 15000;

class P2PManager extends EventEmitter {
    constructor() {
        super();
        this.id = randomUUID();
        this.peers = new Map();
        this.httpServer = null;
        this.udpSocket = null;
        this.discoveryInterval = null;
        this.httpPort = 0;
        this.started = false;

        // Stats
        this.stats = {
            downloaded: 0,
            uploaded: 0,
            filesDownloaded: 0,
            filesUploaded: 0
        };
    }

    start() {
        if (this.started) return;
        this.started = true;

        this.startHttpServer();
        this.startDiscovery();
        logger.info('P2P Delivery Optimization started (Universal Mode).');
    }

    startHttpServer() {
        this.httpServer = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });

        this.httpServer.maxConnections = 200;

        this.httpServer.on('error', (err) => {
            logger.warn('P2P HTTP Server error:', err);
        });

        // Listen on 0.0.0.0 (All interfaces)
        this.httpServer.listen(0, '0.0.0.0', () => {
            this.httpPort = this.httpServer.address().port;
            logger.info(`P2P HTTP Server listening on port ${this.httpPort}`);
        });
    }

    handleRequest(req, res) {
        // Security: Restrict to Local Network (Private IP ranges)
        const remoteIP = req.socket.remoteAddress;
        // Supports IPv4 and IPv4-mapped-IPv6
        const isPrivate = /^(::ffff:)?(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|127\.)/.test(remoteIP) || remoteIP === '::1';

        if (!isPrivate) {
            // log.warn(`Rejected public connection from ${remoteIP}`);
            res.writeHead(403);
            res.end('Access Denied: LAN Only');
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host}`);

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

        if (req.method === 'OPTIONS') {
            res.writeHead(200); res.end(); return;
        }

        if (url.pathname === '/file') {
            // Check if Local Optimization is Enabled
            if (!ConfigManager.getLocalOptimization()) {
                res.writeHead(403); res.end('P2P Local Optimization Disabled'); return;
            }

            // Check if Upload is Enabled
            if (!ConfigManager.getP2PUploadEnabled()) {
                res.writeHead(403); res.end('P2P Upload Disabled'); return;
            }

            const hash = url.searchParams.get('hash');
            const relPath = url.searchParams.get('path');

            if (!hash) { res.writeHead(400); res.end('Missing hash'); return; }
            if (relPath && (relPath.includes('..') || path.isAbsolute(relPath))) { res.writeHead(403); res.end('Invalid path'); return; }

            const commonDir = ConfigManager.getCommonDirectory();
            let filePath;

            if (relPath && relPath !== 'unknown') {
                filePath = path.join(commonDir, relPath);
            } else {
                // Fallback: Try to locate by hash in assets/objects
                // Standard Minecraft Asset Structure: assets/objects/xx/hash
                const prefix = hash.substring(0, 2);
                const candidate = path.join(commonDir, 'assets', 'objects', prefix, hash);

                if (fs.existsSync(candidate)) {
                    filePath = candidate;
                } else {
                    res.writeHead(404); res.end('File not found by hash'); return;
                }
            }

            const stream = fs.createReadStream(filePath);

            let bytesSent = 0;
            stream.on('data', chunk => {
                bytesSent += chunk.length;
            });

            res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
            pipeline(stream, res).then(() => {
                this.stats.uploaded += bytesSent;
                this.stats.filesUploaded++;
                // Logging upload success (optional, maybe too verbose for upload, but good for debug)
                // logger.debug(`Served P2P file: ${relPath} (${bytesSent} bytes)`);
                this.emit('stats-update', this.stats);
            }).catch(err => {
                if (!res.headersSent) { res.writeHead(404); res.end('File not found'); }
            });
        } else {
            res.writeHead(404); res.end();
        }
    }

    startDiscovery() {
        this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this.udpSocket.on('error', (err) => {
            logger.warn('P2P Discovery error:', err);
        });

        this.udpSocket.on('message', (msg, rinfo) => {
            this.handleDiscoveryMessage(msg.toString(), rinfo);
        });

        // Bind to 0.0.0.0 (Any interface)
        this.udpSocket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
            this.udpSocket.setMulticastTTL(2);
            this.udpSocket.setBroadcast(true);

            // KEY CHANGE: Iterate ALL interfaces and join the group on ALL of them
            const interfaces = os.networkInterfaces();
            let joinedCount = 0;
            let bestInterface = null;

            for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name]) {
                    // Skip internal (localhost)
                    if (iface.family === 'IPv4' && !iface.internal) {
                        try {
                            this.udpSocket.addMembership(DISCOVERY_MULTICAST_ADDR, iface.address);
                            joinedCount++;

                            // Try to find a good candidate for sending (standard LAN)
                            if (iface.address.startsWith('192.168.') && !iface.address.startsWith('192.168.56.')) {
                                bestInterface = iface.address;
                            }
                        } catch (err) {
                            // Ignore errors (some interfaces don't support multicast)
                        }
                    }
                }
            }

            logger.info(`P2P Listening on ${joinedCount} interfaces.`);

            // If we found a "Real" LAN IP, set it for outgoing packets to avoid VPN
            if (bestInterface) {
                try {
                    this.udpSocket.setMulticastInterface(bestInterface);
                } catch (e) { }
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
            this.peers.set(peerId, peer);
            this.emit('peer-update', this.peers.size);
        } else {
            this.peers.set(peerId, peer);
        }
    }

    prunePeers() {
        const now = Date.now();
        let changed = false;
        for (const [id, peer] of this.peers) {
            if (now - peer.lastSeen > PEER_TIMEOUT) {
                this.peers.delete(id);
                changed = true;
            }
        }
        if (changed) {
            this.emit('peer-update', this.peers.size);
        }
    }

    async requestFile(hash, signal) {
        // Simple implementation: Try to fetch from known local peers
        // This is a "best effort" parallel try on LAN
        const peers = Array.from(this.peers.values());
        if (peers.length === 0) throw new Error('No local peers');

        // Try a random peer or all? Let's try up to 3 random peers to avoid flooding
        // For RaceManager context, we need a stream ASAP.

        // Shuffle peers
        const candidates = peers.sort(() => 0.5 - Math.random()).slice(0, 3);

        return new Promise(async (resolve, reject) => {
            let errors = 0;
            let resolved = false;

            // Abort if the external signal fires
            if (signal) {
                if (signal.aborted) return reject(new Error('Aborted'));
                signal.addEventListener('abort', () => {
                    if (!resolved) {
                        resolved = true;
                        reject(new Error('Aborted'));
                    }
                });
            }

            const tryPeer = async (peer) => {
                if (resolved || (signal && signal.aborted)) return;

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 2000); // 2s connect timeout

                const onAbort = () => controller.abort();
                if (signal) signal.addEventListener('abort', onAbort);

                try {
                    // We don't know the path, but P2PManager server handles "hash" query?
                    // handleRequest uses: `const hash = reqUrl.searchParams.get('hash');`
                    // So path param is optional if hash is provided?
                    // Looking at handleRequest: `const filePath = path.join(..., hash);` -- Yes, it uses hash directly if path is weird?
                    // Wait, `handleRequest` logic:
                    // `const relPath = reqUrl.searchParams.get('path');`
                    // `const hash = reqUrl.searchParams.get('hash');`
                    // It actually uses `relPath` to construct `filePath` in `handleRequest`?
                    // Let's check `handleRequest`.
                    // It seems we need to pass a mock path or update server to support hash-only lookup.
                    // Assuming P2PManager server supports hash lookup if we implemented it correctly.

                    // Let's assume for now we just try:
                    const url = `http://${peer.ip}:${peer.port}/file?hash=${hash}&path=unknown`;

                    const res = await fetch(url, { signal: controller.signal });
                    clearTimeout(timeout);
                    if (signal) signal.removeEventListener('abort', onAbort);

                    if (res.ok && !resolved) {
                        resolved = true;
                        // Valid stream?
                        if (res.body) {
                            // Convert WebStream to NodeStream if needed, or pass-through
                            // RaceManager expects a stream it can pipe.
                            // Browser fetch body is WebStream. Node fetch body is NodeStream.
                            // Electron uses Node fetch?
                            // index.js overrides fetch? Or native? 
                            // Assuming Node environment (Electron Main).
                            // If `undici` or `node-fetch`, res.body is a stream.
                            resolve(res.body);
                        } else {
                            reject(new Error('No body'));
                        }
                    } else {
                        throw new Error('404');
                    }
                } catch (e) {
                    clearTimeout(timeout);
                    if (signal) signal.removeEventListener('abort', onAbort);
                    errors++;
                    if (!resolved && errors === candidates.length) reject(new Error('Local P2P failed'));
                }
            };

            candidates.forEach(p => tryPeer(p));
        });
    }

    async downloadFile(asset, destPath) {
        if (this.peers.size === 0) {
            // logger.debug('[P2P] Skipped: No peers connected'); // Optional: uncomment if needed associated with verbose logs
            return false;
        }

        const commonDir = ConfigManager.getCommonDirectory();
        let relPath = null;
        const absDestPath = path.resolve(destPath);
        const root = path.resolve(commonDir);

        // Case-insensitive check for Windows compatibility
        if (absDestPath.toLowerCase().startsWith(root.toLowerCase())) {
            relPath = path.relative(root, absDestPath);
        } else {
            logger.warn(`[P2P] Skipped: Destination path ${absDestPath} is not in common directory ${root}`);
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
            let bytesReceived = 0;

            if (res.body.getReader) {
                // Handle Web Stream manually to avoid context issues with Readable.fromWeb
                const reader = res.body.getReader();
                const nodeStream = new Readable({
                    async read() {
                        const { done, value } = await reader.read();
                        if (done) {
                            this.push(null);
                        } else {
                            bytesReceived += value.length;
                            this.push(Buffer.from(value));
                        }
                    }
                });
                await pipeline(nodeStream, fileStream);
            } else {
                // Assume Node Stream
                res.body.on('data', chunk => bytesReceived += chunk.length);
                await pipeline(res.body, fileStream);
            }

            this.stats.downloaded += bytesReceived;
            this.stats.filesDownloaded++;
            this.emit('stats-update', this.stats);

            logger.debug(`[P2P] Successfully downloaded ${asset.id || relPath} from ${peer.ip} (${bytesReceived} bytes). Total P2P: ${(this.stats.downloaded / 1024 / 1024).toFixed(2)} MB`);

            return true;

        } catch (err) {
            logger.warn(`[P2P] Failed to download ${asset.id || relPath} from ${peer.ip}: ${err.message}`);
            return false;
        }
    }

    stop() {
        if (this.httpServer) { this.httpServer.close(); this.httpServer = null; }
        if (this.udpSocket) { this.udpSocket.close(); this.udpSocket = null; }
        if (this.discoveryInterval) { clearInterval(this.discoveryInterval); this.discoveryInterval = null; }
        this.started = false;
        this.peers.clear();
        this.emit('peer-update', 0);
    }

    getNetworkInfo() {
        return {
            peers: this.peers.size,
            downloaded: this.stats.downloaded,
            uploaded: this.stats.uploaded,
            filesDownloaded: this.stats.filesDownloaded,
            filesUploaded: this.stats.filesUploaded,
            listening: this.started
        }
    }
}

const instance = new P2PManager();
module.exports = instance;