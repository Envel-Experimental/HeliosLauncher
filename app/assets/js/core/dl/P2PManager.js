const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { LoggerUtil } = require('../util/LoggerUtil');
const ConfigManager = require('../../configmanager');

const logger = LoggerUtil.getLogger('P2PManager');

const DISCOVERY_PORT = 45565;
const DISCOVERY_INTERVAL = 5000;
const PEER_TIMEOUT = 15000; // Remove peer if not seen for 15s

class P2PManager {
    constructor() {
        this.id = randomUUID();
        this.peers = new Map(); // id -> { ip, port, lastSeen }
        this.httpServer = null;
        this.udpSocket = null;
        this.discoveryInterval = null;
        this.httpPort = 0;
        this.started = false;
    }

    start() {
        if (this.started) return;
        this.started = true;
        this.startHttpServer();
        this.startDiscovery();
        logger.info('P2P Delivery Optimization started.');
    }

    startHttpServer() {
        this.httpServer = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });

        this.httpServer.on('error', (err) => {
            logger.warn('P2P HTTP Server error:', err);
        });

        this.httpServer.listen(0, () => {
            this.httpPort = this.httpServer.address().port;
            logger.info(`P2P HTTP Server listening on port ${this.httpPort}`);
        });
    }

    handleRequest(req, res) {
        const url = new URL(req.url, `http://${req.headers.host}`);

        // CORS headers
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

            // Security check: Prevent directory traversal
            if (relPath.includes('..') || path.isAbsolute(relPath)) {
                res.writeHead(403);
                res.end('Invalid path');
                return;
            }

            // Resolve path
            // We assume files are in common directory (assets, libraries, etc.)
            const commonDir = ConfigManager.getCommonDirectory();
            const filePath = path.join(commonDir, relPath);

            // Verify file exists
            fs.access(filePath, fs.constants.R_OK, (err) => {
                if (err) {
                    res.writeHead(404);
                    res.end('File not found');
                    return;
                }

                // Serve file
                const stream = fs.createReadStream(filePath);
                res.writeHead(200, {
                    'Content-Type': 'application/octet-stream'
                });
                stream.pipe(res);
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    }

    startDiscovery() {
        this.udpSocket = dgram.createSocket('udp4');

        this.udpSocket.on('error', (err) => {
            logger.warn('P2P Discovery error:', err);
            this.udpSocket.close();
        });

        this.udpSocket.on('message', (msg, rinfo) => {
            this.handleDiscoveryMessage(msg.toString(), rinfo);
        });

        this.udpSocket.bind(DISCOVERY_PORT, () => {
            this.udpSocket.setBroadcast(true);

            // Start broadcasting
            this.discoveryInterval = setInterval(() => {
                this.broadcastPresence();
                this.prunePeers();
            }, DISCOVERY_INTERVAL);

            this.broadcastPresence();
        });
    }

    broadcastPresence() {
        if (!this.httpPort) return;
        const message = Buffer.from(`HELIOS_P2P:${this.id}:${this.httpPort}`);
        this.udpSocket.send(message, 0, message.length, DISCOVERY_PORT, '255.255.255.255');
    }

    handleDiscoveryMessage(msg, rinfo) {
        if (!msg.startsWith('HELIOS_P2P:')) return;

        const parts = msg.split(':');
        if (parts.length < 3) return;

        const peerId = parts[1];
        const peerPort = parseInt(parts[2]);

        if (peerId === this.id) return; // Ignore self

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
                logger.info(`Peer lost: ${peer.ip}:${peer.port}`);
            }
        }
    }

    async downloadFile(asset, destPath) {
        if (this.peers.size === 0) return false;

        const commonDir = ConfigManager.getCommonDirectory();
        let relPath = null;

        const assetPath = path.resolve(asset.path);
        const root = path.resolve(commonDir);

        if (assetPath.startsWith(root)) {
            relPath = path.relative(root, assetPath);
        } else {
            return false;
        }

        relPath = relPath.replace(/\\/g, '/');
        const peers = Array.from(this.peers.values());

        const peerRequests = peers.map(peer => {
            const controller = new AbortController();
            const url = `http://${peer.ip}:${peer.port}/file?hash=${asset.hash}&path=${encodeURIComponent(relPath)}`;

            // Race logic: Connect and get 200 OK.
            // Set a short timeout for connection.
            const timeoutId = setTimeout(() => controller.abort(), 1000);

            return {
                promise: fetch(url, { signal: controller.signal })
                    .then(res => {
                        clearTimeout(timeoutId);
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        return { res, controller };
                    })
                    .catch(err => {
                        clearTimeout(timeoutId);
                        throw err;
                    }),
                controller
            };
        });

        try {
            const { res, controller: winnerController } = await Promise.any(peerRequests.map(p => p.promise));

            // Abort others
            peerRequests.forEach(p => {
                if (p.controller !== winnerController) p.controller.abort();
            });

            // Stream to file
            const fileStream = fs.createWriteStream(destPath);

            // Pipe response body to file
            // Use Readable.fromWeb if available (Node 18+)
            if (Readable.fromWeb) {
                const nodeStream = Readable.fromWeb(res.body);
                await pipeline(nodeStream, fileStream);
            } else {
                // Fallback (unlikely needed with Node >= 20)
                const reader = res.body.getReader();
                const nodeStream = new Readable({
                    async read() {
                        const { done, value } = await reader.read();
                        if (done) {
                            this.push(null);
                        } else {
                            this.push(Buffer.from(value));
                        }
                    }
                });
                await pipeline(nodeStream, fileStream);
            }

            return true;

        } catch (err) {
            // All failed
            return false;
        }
    }

    stop() {
        if (this.httpServer) {
            this.httpServer.close();
            this.httpServer = null;
        }
        if (this.udpSocket) {
            this.udpSocket.close();
            this.udpSocket = null;
        }
        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
            this.discoveryInterval = null;
        }
        this.started = false;
    }
}

const instance = new P2PManager();
module.exports = instance;
