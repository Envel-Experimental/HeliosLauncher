// @ts-check

const crypto = require('crypto');
const { resolve } = require('path');
const fs = require('fs/promises');
const { LoggerUtil } = require('../util/LoggerUtil');
const { RestResponseStatus, handleFetchError } = require('./RestResponse');
const { HeliosDistribution } = require('./DistributionClasses');
const { fetchWithTimeout } = require('../configmanager');

class DistributionAPI {
    static log = LoggerUtil.getLogger('DistributionAPI');

    /**
     * @param {string} launcherDirectory 
     * @param {string} commonDir 
     * @param {string} instanceDir 
     * @param {string | string[]} remoteUrls 
     * @param {boolean} devMode 
     * @param {string[]} [trustedKeys] 
     */
    constructor(launcherDirectory, commonDir, instanceDir, remoteUrls, devMode, trustedKeys) {
        this.launcherDirectory = launcherDirectory;
        this.commonDir = commonDir;
        this.instanceDir = instanceDir;
        this.remoteUrls = Array.isArray(remoteUrls) ? remoteUrls : [remoteUrls];
        this.devMode = devMode;
        this.trustedKeys = trustedKeys;
        console.log('[DistributionAPI] Initialized with trusted keys:', this.trustedKeys);
        this.DISTRO_FILE = 'distribution.json';
        this.DISTRO_FILE_DEV = 'distribution_dev.json';
        this.distroPath = resolve(launcherDirectory, this.DISTRO_FILE);
        this.distroDevPath = resolve(launcherDirectory, this.DISTRO_FILE_DEV);
        /**
         * @type {DistributionData | null}
         */
        this.rawDistribution = null;
        /**
         * @type {HeliosDistribution | null}
         */
        this.distribution = null;
    }

    /**
     * @returns {Promise<HeliosDistribution>}
     */
    async getDistribution() {
        if (this.rawDistribution == null) {
            this.rawDistribution = await this.loadDistribution();
            this.distribution = new HeliosDistribution(this.rawDistribution, this.commonDir, this.instanceDir);
        }
        console.log('[DistributionAPI] getDistribution returning servers:', this.distribution.servers.map(s => s.rawServer.id));
        return this.distribution;
    }

    /**
     * @returns {Promise<HeliosDistribution>}
     */
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

    /**
     * @returns {Promise<HeliosDistribution | null>}
     */
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

    /**
     * @param {boolean} dev 
     */
    toggleDevMode(dev) {
        this.devMode = dev;
    }

    isDevMode() {
        return this.devMode;
    }

    /**
     * @returns {Promise<DistributionData>}
     */
    async loadDistribution() {
        const distro = await this._loadDistributionNullable();
        if (distro == null) {
            throw new Error('FATAL: Unable to load distribution from remote server or local disk.');
        }
        return distro;
    }

    /**
     * @returns {Promise<DistributionData | null>}
     */
    async _loadDistributionNullable() {
        console.log('[DistributionAPI] Loading distribution... devMode:', this.devMode);
        /** @type {DistributionData | null} */
        let distro = null;
        if (!this.devMode) {
            distro = (await this.pullRemote()).data;
            if (distro == null) {
                distro = await this.pullLocal();
            }
            else {
                try {
                    await this.writeDistributionToDisk(distro);
                } catch (err) {
                    console.error('[DistributionAPI] Failed to write distribution to disk:', err);
                    // Continue anyway with the in-memory distro to let user play
                }
            }
        }
        else {
            distro = await this.pullLocal();
            if (distro == null) {
                console.log('[DistributionAPI] devMode: distribution_dev.json missing, falling back to production distribution.json');
                distro = await this.readDistributionFromFile(this.distroPath);
            }
            if (distro == null) {
                console.log('[DistributionAPI] devMode: local distribution files missing, falling back to remote...');
                distro = (await this.pullRemote()).data;
                if (distro != null) {
                    try {
                        await this.writeDistributionToDisk(distro);
                    } catch (err) {
                        console.error('[DistributionAPI] Failed to write remote distribution to disk (dev fallback):', err);
                    }
                }
            }
        }
        return distro;
    }

    async pullRemote() {
        let lastError = null;

        for (const url of this.remoteUrls) {
            try {
                console.log(`[DistributionAPI] Pulling remote distribution from: ${url}`);
                const res = await fetchWithTimeout(url, { cache: 'no-store' }, 8000);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                // Get buffer first to preserve exact bytes for verification
                const rawBuffer = Buffer.from(await res.arrayBuffer());
                const rawText = rawBuffer.toString('utf-8');
                const data = JSON.parse(rawText);

                let signatureValid = true; // Default to true if no keys configured (or logic disabled)

                if (this.trustedKeys && Array.isArray(this.trustedKeys) && this.trustedKeys.length > 0) {
                    console.log('[DistributionAPI] Verifying signature via Main Process...')
                    signatureValid = false
                    try {
                        const sigRes = await fetchWithTimeout(url + '.sig', { cache: 'no-store' }, 5000)
                        if (sigRes.ok) {
                            const signatureHex = (await sigRes.text()).trim()
                            
                            const verifyData = {
                                dataHex: rawBuffer.toString('hex'),
                                signatureHex: signatureHex,
                                trustedKeys: this.trustedKeys
                            }

                            if (process.type === 'renderer') {
                                // Invoke Main Process to verify the buffer
                                signatureValid = await window.ipcRenderer.invoke('distribution:verify', verifyData)
                            } else {
                                // Direct verification in Main process
                                const { verifyDistribution } = require('../util/SignatureUtils')
                                signatureValid = verifyDistribution(verifyData)
                            }

                            if (signatureValid) {
                                console.log('[DistributionAPI] Signature VALID.')
                            } else {
                                console.warn('[DistributionAPI] Signature verification failed in Main Process.')
                            }
                        } else {
                            console.warn(`[DistributionAPI] Signature file missing (${sigRes.status})`)
                        }
                    } catch (e) {
                        DistributionAPI.log.warn('Signature verification call error:', e)
                    }
                }

                console.log('[DistributionAPI] Final signatureValid state:', signatureValid);

                if (!signatureValid && this.trustedKeys && this.trustedKeys.length > 0) {
                    /** @type {Error & { dataPackage?: any }} */
                    const err = new Error('Distribution signature verification failed.');
                    err.dataPackage = {
                        data: data,
                        responseStatus: RestResponseStatus.SUCCESS,
                        signatureValid: false
                    }
                    throw err;
                }

                // If successful, return immediately
                return {
                    data: data,
                    responseStatus: RestResponseStatus.SUCCESS,
                    signatureValid: signatureValid
                };

            } catch (err) {
                /** @type {Error & { dataPackage?: any }} */
                const error = err instanceof Error ? err : new Error(String(err));
                console.error(`[DistributionAPI] Pull Failed from ${url}:`, error.message);
                lastError = error;
                if (error.dataPackage && error.dataPackage.signatureValid === false) {
                    console.warn('[DistributionAPI] Signature validation failed. Trying next mirror...');
                    lastError = error; // Save this specific error as it's more informative
                }
            }
        }

        // If loop finishes, all failed.
        console.error('[DistributionAPI] All distribution sources failed.');
        return handleFetchError('Pull Remote', lastError || new Error('All mirrors failed'), DistributionAPI.log);
    }

    /**
     * @param {DistributionData} distribution 
     */
    async writeDistributionToDisk(distribution) {
        // Ensure directory exists (v3.1 Fix for ENOENT)
        await fs.mkdir(this.launcherDirectory, { recursive: true });
        await fs.writeFile(this.distroPath, JSON.stringify(distribution, null, 4));
    }

    /**
     * @returns {Promise<DistributionData | null>}
     */
    async pullLocal() {
        return await this.readDistributionFromFile(!this.devMode ? this.distroPath : this.distroDevPath);
    }

    /**
     * @param {string} path 
     * @returns {Promise<DistributionData | null>}
     */
    async readDistributionFromFile(path) {
        console.log('[DistributionAPI] Reading distribution from:', path);
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
