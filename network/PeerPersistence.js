const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const ConfigManager = require('../app/assets/js/configmanager');

class PeerPersistence {
    constructor() {
        this.filePath = path.join(ConfigManager.getLauncherDirectory(), 'peers.enc');
        // Machine-specific encryption
        try {
            this.secret = 'XFc7SgZJ' + os.userInfo().username;
            this.salt = os.hostname();
        } catch (e) {
            this.secret = 'XFc7SgZJDefault';
            this.salt = 'DefaultHost';
        }
        this.algorithm = 'aes-256-cbc';
        this.cache = {
            local: [],
            global: []
        };
        this.loaded = false;
    }

    _getKey() {
        return crypto.scryptSync(this.secret, this.salt, 32);
    }

    async load() {
        if (this.loaded) return;

        try {
            if (fs.existsSync(this.filePath)) {
                const encrypted = await fs.promises.readFile(this.filePath);

                // Decrypt
                const iv = encrypted.slice(0, 16);
                const data = encrypted.slice(16);
                const decipher = crypto.createDecipheriv(this.algorithm, this._getKey(), iv);
                let decrypted = decipher.update(data);
                decrypted = Buffer.concat([decrypted, decipher.final()]);

                const json = JSON.parse(decrypted.toString());

                // Validate and Prune
                const now = Date.now();
                // Expire after 14 days (allows weekly launches)
                const MAX_AGE = 14 * 24 * 60 * 60 * 1000;

                this.cache = {
                    local: this._validateList(json.local, now, MAX_AGE),
                    global: this._validateList(json.global, now, MAX_AGE)
                };
            }
        } catch (err) {
            console.error('[PeerPersistence] Failed to load/decrypt peers', err);
            // Corrupt file? Reset.
            this.cache = { local: [], global: [] };
        }
        this.loaded = true;
    }

    _validateList(list, now, maxAge) {
        if (!Array.isArray(list)) return [];
        return list.filter(p => {
            // Must be an object, have ip/port, and not be too old
            return p &&
                typeof p === 'object' &&
                typeof p.ip === 'string' &&
                p.ip.length > 0 &&
                p.port &&
                (now - (p.lastSeen || 0) < maxAge);
        });
    }

    async save() {
        if (!this.loaded) return; // Don't overwrite if not loaded

        const json = JSON.stringify(this.cache);

        // Encrypt
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, this._getKey(), iv);
        let encrypted = cipher.update(json);
        encrypted = Buffer.concat([encrypted, cipher.final()]);

        const output = Buffer.concat([iv, encrypted]);

        // Atomic Write
        const tempPath = this.filePath + '.tmp';
        try {
            await fs.promises.writeFile(tempPath, output);
            await fs.promises.rename(tempPath, this.filePath);
        } catch (err) {
            console.error('[PeerPersistence] Failed to save peers', err);
            try { await fs.promises.unlink(tempPath); } catch (e) { }
        }
    }

    /**
     * Update a peer in the store.
     * @param {string} type 'local' or 'global'
     * @param {Object} peer { ip, port, score, ... }
     */
    updatePeer(type, peer) {
        if (!this.cache[type]) this.cache[type] = [];

        const list = this.cache[type];
        const idx = list.findIndex(p => p.ip === peer.ip && p.port === peer.port);

        const entry = {
            ip: peer.ip,
            port: peer.port,
            publicKey: peer.publicKey, // Added for direct connection
            lastSeen: Date.now(),
            score: peer.score || 0,
            avgSpeed: peer.avgSpeed || 0
        };

        if (idx > -1) {
            list[idx] = entry;
        } else {
            list.push(entry);
        }

        // Limit to top 100 "good" peers
        this.cache[type] = list
            .sort((a, b) => b.score - a.score) // Descending score
            .slice(0, 100);

        // Save async (debounce could be added but simple for now)
        this.save().catch(e => { }); // Fire and forget
    }

    getPeers(type) {
        return this.cache[type] || [];
    }
}

module.exports = new PeerPersistence();
