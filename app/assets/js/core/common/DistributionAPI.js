const { resolve } = require('path');
const fs = require('fs/promises');
const { LoggerUtil } = require('../util/LoggerUtil');
const { RestResponseStatus, handleFetchError } = require('./RestResponse');
const { HeliosDistribution } = require('./DistributionClasses');

class DistributionAPI {
    static log = LoggerUtil.getLogger('DistributionAPI');

    constructor(launcherDirectory, commonDir, instanceDir, remoteUrl, devMode, trustedKeys) {
        this.launcherDirectory = launcherDirectory;
        this.commonDir = commonDir;
        this.instanceDir = instanceDir;
        this.remoteUrl = remoteUrl;
        this.devMode = devMode;
        this.trustedKeys = trustedKeys;
        console.log('[DistributionAPI] Initialized with trusted keys:', this.trustedKeys);
        this.DISTRO_FILE = 'distribution.json';
        this.DISTRO_FILE_DEV = 'distribution_dev.json';
        this.distroPath = resolve(launcherDirectory, this.DISTRO_FILE);
        this.distroDevPath = resolve(launcherDirectory, this.DISTRO_FILE_DEV);
        this.rawDistribution = null;
        this.distribution = null;
    }

    async getDistribution() {
        if (this.rawDistribution == null) {
            this.rawDistribution = await this.loadDistribution();
            this.distribution = new HeliosDistribution(this.rawDistribution, this.commonDir, this.instanceDir);
        }
        return this.distribution;
    }

    async getDistributionLocalLoadOnly() {
        if (this.rawDistribution == null) {
            const x = await this.pullLocal();
            if (x == null) {
                throw new Error('FATAL: Unable to load distribution from local disk.');
            }
            this.rawDistribution = x;
            this.distribution = new HeliosDistribution(this.rawDistribution, this.commonDir, this.instanceDir);
        }
        return this.distribution;
    }

    async refreshDistributionOrFallback() {
        const distro = await this._loadDistributionNullable();
        if (distro == null) {
            DistributionAPI.log.warn('Failed to refresh distribution, falling back to current load (if exists).');
            return this.distribution;
        }
        else {
            this.rawDistribution = distro;
            this.distribution = new HeliosDistribution(distro, this.commonDir, this.instanceDir);
            return this.distribution;
        }
    }

    toggleDevMode(dev) {
        this.devMode = dev;
    }

    isDevMode() {
        return this.devMode;
    }

    async loadDistribution() {
        const distro = await this._loadDistributionNullable();
        if (distro == null) {
            throw new Error('FATAL: Unable to load distribution from remote server or local disk.');
        }
        return distro;
    }

    async _loadDistributionNullable() {
        let distro;
        if (!this.devMode) {
            distro = (await this.pullRemote()).data;
            if (distro == null) {
                distro = await this.pullLocal();
            }
            else {
                await this.writeDistributionToDisk(distro);
            }
        }
        else {
            distro = await this.pullLocal();
        }
        return distro;
    }

    async pullRemote() {
        try {
            console.log('[DistributionAPI] Pulling remote distribution...');
            const res = await fetch(this.remoteUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            // Get text first to preserve exact bytes for verification
            const rawText = await res.text();
            const data = JSON.parse(rawText);

            let signatureValid = true; // Default to true if no keys configured (or logic disabled)

            if (this.trustedKeys && this.trustedKeys.length > 0) {
                console.log('[DistributionAPI] Verifying signature...')
                signatureValid = false
                try {
                    const sigRes = await fetch(this.remoteUrl + '.sig')
                    if (sigRes.ok) {
                        const signatureHex = (await sigRes.text()).trim()
                        const signature = Buffer.from(signatureHex, 'hex')
                        // Normalize the JSON data to ensure consistency across different OS/formatting
                        const normalizedText = JSON.stringify(data)
                        const contentBuffer = Buffer.from(normalizedText, 'utf-8')

                        const crypto = require('crypto')
                        // ASN.1 Header for Ed25519 Public Key (SPKI)
                        const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

                        for (const keyHex of this.trustedKeys) {
                            try {
                                const rawKey = Buffer.from(keyHex, 'hex')
                                // Wrap raw key in SPKI format for Node's crypto
                                const spkiKey = Buffer.concat([ED25519_SPKI_PREFIX, rawKey])
                                const publicKey = crypto.createPublicKey({
                                    key: spkiKey,
                                    format: 'der',
                                    type: 'spki'
                                })

                                if (crypto.verify(null, contentBuffer, publicKey, signature)) {
                                    signatureValid = true
                                    console.log('[DistributionAPI] Signature VALID.')
                                    break
                                }
                            } catch (e) {
                                console.warn('[DistributionAPI] Key check failed:', e.message)
                            }
                        }
                    } else {
                        console.warn(`[DistributionAPI] Signature file missing (${sigRes.status})`)
                    }
                } catch (e) {
                    DistributionAPI.log.warn('Signature verification error:', e)
                }
            }

            console.log('[DistributionAPI] Final signatureValid state:', signatureValid);

            return {
                data: data,
                responseStatus: RestResponseStatus.SUCCESS,
                signatureValid: signatureValid
            };
        }
        catch (error) {
            console.error('[DistributionAPI] Pull Failed:', error);
            return handleFetchError('Pull Remote', error, DistributionAPI.log);
        }
    }

    async writeDistributionToDisk(distribution) {
        await fs.writeFile(this.distroPath, JSON.stringify(distribution, null, 4));
    }

    async pullLocal() {
        return await this.readDistributionFromFile(!this.devMode ? this.distroPath : this.distroDevPath);
    }

    async readDistributionFromFile(path) {
        try {
            await fs.access(path);
            const raw = await fs.readFile(path, 'utf-8');
            try {
                return JSON.parse(raw);
            }
            catch (error) {
                DistributionAPI.log.error(`Malformed distribution file at ${path}`);
                return null;
            }
        } catch (e) {
            DistributionAPI.log.error(`No distribution file found at ${path}!`);
            return null;
        }
    }
}

module.exports = { DistributionAPI }
