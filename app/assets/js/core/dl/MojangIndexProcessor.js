const path = require('path');
const fs = require('fs/promises');
const { HashAlgo } = require('./Asset');
const { AssetGuardError } = require('./AssetGuardError');
const { IndexProcessor } = require('./IndexProcessor');
const { getVersionJsonPath, validateLocalFile, getLibraryDir, getVersionJarPath, calculateHashByBuffer, safeEnsureDir } = require('../common/FileUtils');
const { mcVersionAtLeast, isLibraryCompatible, getMojangOS } = require('../common/MojangUtils');
const { LoggerUtil } = require('../util/LoggerUtil');
const { handleFetchError } = require('../common/RestResponse');
const { MOJANG_URLS } = require('../../config/constants');

class MojangIndexProcessor extends IndexProcessor {
    static logger = LoggerUtil.getLogger('MojangIndexProcessor');

    constructor(commonDir, version) {
        super(commonDir);
        this.version = version;
        this.assetPath = path.join(commonDir, 'assets');
    }

    async init() {
        const versionManifest = await this.loadVersionManifest();
        this.versionJson = await this.loadVersionJson(this.version, versionManifest);
        this.assetIndex = await this.loadAssetIndex(this.versionJson);
    }

    async getVersionJson() {
        const versionManifest = await this.loadVersionManifest();
        return await this.loadVersionJson(this.version, versionManifest);
    }

    async loadAssetIndex(versionJson) {
        const assetIndexPath = this.getAssetIndexPath(versionJson.assetIndex.id);
        const assetIndex = await this.loadContentWithRemoteFallback(versionJson.assetIndex.url, assetIndexPath, { algo: HashAlgo.SHA1, value: versionJson.assetIndex.sha1 });
        if (assetIndex == null) {
            throw new AssetGuardError(`Failed to download ${versionJson.assetIndex.id} asset index.`);
        }
        return assetIndex;
    }

    async loadVersionJson(version, versionManifest) {
        const versionJsonPath = getVersionJsonPath(this.commonDir, version);
        if (versionManifest != null) {
            const versionInfo = versionManifest.versions.find(({ id }) => id === version);
            if (versionInfo == null) {
                throw new AssetGuardError(`Invalid version: ${version}.`);
            }
            const versionJson = await this.loadContentWithRemoteFallback(versionInfo.url, versionJsonPath, { algo: HashAlgo.SHA1, value: versionInfo.sha1 });
            if (versionJson == null) {
                throw new AssetGuardError(`Failed to download ${version} json index.`);
            }
            if (process.arch === 'arm64' && !mcVersionAtLeast('1.19', version)) {
                const latestVersion = versionManifest.latest.release;
                const latestVersionJsonPath = getVersionJsonPath(this.commonDir, latestVersion);
                const latestVersionInfo = versionManifest.versions.find(({ id }) => id === latestVersion);
                if (latestVersionInfo == null) {
                    throw new AssetGuardError('Cannot find the latest version.');
                }
                const latestVersionJson = await this.loadContentWithRemoteFallback(latestVersionInfo.url, latestVersionJsonPath, { algo: HashAlgo.SHA1, value: latestVersionInfo.sha1 });
                if (latestVersionJson == null) {
                    throw new AssetGuardError(`Failed to download ${latestVersion} json index.`);
                }
                MojangIndexProcessor.logger.info(`Using LWJGL from ${latestVersion} for ARM64 compatibility.`);
                versionJson.libraries = versionJson.libraries.filter(l => !l.name.startsWith('org.lwjgl:')).concat(latestVersionJson.libraries.filter(l => l.name.startsWith('org.lwjgl:')));
            }
            return versionJson;
        }
        else {
            try {
                await fs.access(versionJsonPath);
                return JSON.parse(await fs.readFile(versionJsonPath, 'utf8'));
            } catch (e) {
                throw new AssetGuardError(`Unable to load version manifest and ${version} json index does not exist locally.`);
            }
        }
    }

    async loadContentWithRemoteFallback(url, filePath, hash) {
        try {
            await fs.access(filePath);
            const buf = await fs.readFile(filePath);
            if (hash) {
                const bufHash = calculateHashByBuffer(buf, hash.algo);
                if (bufHash === hash.value) {
                    return JSON.parse(buf.toString());
                }
            } else {
                 return JSON.parse(buf.toString());
            }
        } catch (error) {
             // File doesn't exist or invalid
        }

        // Handle array of URLs for mirroring
        const urls = Array.isArray(url) ? url : [url];
        let lastError;

        for (const u of urls) {
            try {
                const res = await fetch(u);
                if(!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();

                await safeEnsureDir(path.dirname(filePath));
                await fs.writeFile(filePath, JSON.stringify(data));
                return data;
            } catch (error) {
                lastError = error;
                MojangIndexProcessor.logger.warn(`Failed to load content from ${u}: ${error.message}`);
            }
        }

        handleFetchError(urls[0], lastError || new Error('All mirrors failed'), MojangIndexProcessor.logger);
        return null;
    }

    async loadVersionManifest() {
        const urls = MOJANG_URLS.VERSION_MANIFEST;
        let lastError;

        for (const url of urls) {
            try {
                const res = await fetch(url);
                if(!res.ok) throw new Error(`HTTP ${res.status}`);
                return await res.json();
            } catch (error) {
                lastError = error;
                MojangIndexProcessor.logger.warn(`Failed to load version manifest from ${url}: ${error.message}`);
            }
        }
        handleFetchError('Load Mojang Version Manifest', lastError || new Error('All mirrors failed'), MojangIndexProcessor.logger);
        return null;
    }

    getAssetIndexPath(id) {
        return path.join(this.assetPath, 'indexes', `${id}.json`);
    }

    totalStages() {
        return 4;
    }

    async validate(onStageComplete) {
        const assets = await this.validateAssets(this.assetIndex);
        if(onStageComplete) await onStageComplete();
        const libraries = await this.validateLibraries(this.versionJson);
         if(onStageComplete) await onStageComplete();
        const client = await this.validateClient(this.versionJson);
         if(onStageComplete) await onStageComplete();
        const logConfig = await this.validateLogConfig(this.versionJson);
         if(onStageComplete) await onStageComplete();
        return {
            assets,
            libraries,
            client,
            misc: [
                ...logConfig
            ]
        };
    }

    async postDownload() {
        // no-op
    }

    async validateAssets(assetIndex) {
        const objectDir = path.join(this.assetPath, 'objects');
        // Dynamic import for ESM module
        const { default: pLimit } = await import('p-limit');
        const limit = pLimit(32); // Concurrency limit 32

        const tasks = Object.entries(assetIndex.objects).map(([id, meta]) => {
            return limit(async () => {
                const hash = meta.hash;
                const filePath = path.join(objectDir, hash.substring(0, 2), hash);
                const urls = MOJANG_URLS.ASSET_RESOURCE.map(base => `${base}/${hash.substring(0, 2)}/${hash}`);

                if (!await validateLocalFile(filePath, HashAlgo.SHA1, hash)) {
                    return {
                        id,
                        hash,
                        algo: HashAlgo.SHA1,
                        size: meta.size,
                        url: urls,
                        path: filePath
                    };
                }
                return null;
            });
        });

        const results = await Promise.all(tasks);
        return results.filter(Boolean);
    }

    async validateLibraries(versionJson) {
        const libDir = getLibraryDir(this.commonDir);
        // Dynamic import for ESM module
        const { default: pLimit } = await import('p-limit');
        const limit = pLimit(32);

        const tasks = versionJson.libraries.map(libEntry => {
            return limit(async () => {
                if (isLibraryCompatible(libEntry.rules, libEntry.natives)) {
                    let artifact;
                    if (libEntry.natives == null) {
                        artifact = libEntry.downloads.artifact;
                    }
                    else {
                        const classifier = libEntry.natives[getMojangOS()].replace('${arch}', process.arch.replace('x', ''));
                        artifact = libEntry.downloads.classifiers[classifier];
                    }

                    if (artifact) {
                        const filePath = path.join(libDir, artifact.path);
                        const hash = artifact.sha1;
                        if (!await validateLocalFile(filePath, HashAlgo.SHA1, hash)) {
                            return {
                                id: libEntry.name,
                                hash,
                                algo: HashAlgo.SHA1,
                                size: artifact.size,
                                url: artifact.url,
                                path: filePath
                            };
                        }
                    }
                }
                return null;
            });
        });

        const results = await Promise.all(tasks);
        return results.filter(Boolean);
    }

    async validateClient(versionJson) {
        const version = versionJson.id;
        const versionJarPath = getVersionJarPath(this.commonDir, version);
        const hash = versionJson.downloads.client.sha1;
        if (!await validateLocalFile(versionJarPath, HashAlgo.SHA1, hash)) {
            return [{
                    id: `${version} client`,
                    hash,
                    algo: HashAlgo.SHA1,
                    size: versionJson.downloads.client.size,
                    url: versionJson.downloads.client.url,
                    path: versionJarPath
                }];
        }
        return [];
    }

    async validateLogConfig(versionJson) {
        if(!versionJson.logging || !versionJson.logging.client) return [];
        const logFile = versionJson.logging.client.file;
        const filePath = path.join(this.assetPath, 'log_configs', logFile.id);
        const hash = logFile.sha1;
        if (!await validateLocalFile(filePath, HashAlgo.SHA1, hash)) {
            return [{
                    id: logFile.id,
                    hash,
                    algo: HashAlgo.SHA1,
                    size: logFile.size,
                    url: logFile.url,
                    path: filePath
                }];
        }
        return [];
    }
}

module.exports = { MojangIndexProcessor }
