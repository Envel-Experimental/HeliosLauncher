const path = require('path');
const fs = require('fs/promises');
const { HashAlgo } = require('./Asset');
const { AssetGuardError } = require('./AssetGuardError');
const { IndexProcessor } = require('./IndexProcessor');
const { getVersionJsonPath, validateLocalFile, getLibraryDir, getVersionJarPath, calculateHashByBuffer, safeEnsureDir } = require('../common/FileUtils');
const { downloadFile } = require('./DownloadEngine');
const { mcVersionAtLeast, isLibraryCompatible, getMojangOS } = require('../common/MojangUtils');
const { LoggerUtil } = require('../util/LoggerUtil');
const { handleFetchError } = require('../common/RestResponse');
const { MOJANG_MIRRORS } = require('../../../../../network/config');
const ConfigManager = require('../../configmanager');

class MojangIndexProcessor extends IndexProcessor {
    static LAUNCHER_JSON_ENDPOINT = 'https://launchermeta.mojang.com/mc/launcher.json';
    static VERSION_MANIFEST_ENDPOINT = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
    static ASSET_RESOURCE_ENDPOINT = 'https://resources.download.minecraft.net';
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
        return await this.loadContentWithRemoteFallback(versionJson.assetIndex.url, assetIndexPath, { algo: HashAlgo.SHA1, value: versionJson.assetIndex.sha1 });
    }

    async loadVersionJson(version, versionManifest) {
        const versionJsonPath = getVersionJsonPath(this.commonDir, version);
        if (versionManifest != null) {
            const versionInfo = versionManifest.versions.find(({ id }) => id === version);
            if (versionInfo == null) {
                throw new AssetGuardError(`Invalid version: ${version}.`);
            }
            const versionJson = await this.loadContentWithRemoteFallback(versionInfo.url, versionJsonPath, { algo: HashAlgo.SHA1, value: versionInfo.sha1 });

            if (process.arch === 'arm64' && !mcVersionAtLeast('1.19', version)) {
                const latestVersion = versionManifest.latest.release;
                const latestVersionJsonPath = getVersionJsonPath(this.commonDir, latestVersion);
                const latestVersionInfo = versionManifest.versions.find(({ id }) => id === latestVersion);
                if (latestVersionInfo == null) {
                    throw new AssetGuardError('Cannot find the latest version.');
                }
                const latestVersionJson = await this.loadContentWithRemoteFallback(latestVersionInfo.url, latestVersionJsonPath, { algo: HashAlgo.SHA1, value: latestVersionInfo.sha1 });

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
        // Prepare Mirror Candidates
        const candidates = [];
        if (MOJANG_MIRRORS && MOJANG_MIRRORS.length > 0) {
            for (const mirror of MOJANG_MIRRORS) {
                if (url.includes(MojangIndexProcessor.ASSET_RESOURCE_ENDPOINT) && mirror.assets) {
                    candidates.push(url.replace(MojangIndexProcessor.ASSET_RESOURCE_ENDPOINT, mirror.assets));
                } else if (url.includes(MojangIndexProcessor.VERSION_MANIFEST_ENDPOINT) && mirror.version_manifest) {
                    candidates.push(mirror.version_manifest);
                } else if (mirror.version_manifest && url.includes('piston-meta.mojang.com')) {
                    candidates.push(url.replace('https://piston-meta.mojang.com', mirror.version_manifest.replace('/mc/game/version_manifest_v2.json', '')));
                } else if (url.includes(MojangIndexProcessor.LAUNCHER_JSON_ENDPOINT) && mirror.launcher_meta) {
                    candidates.push(mirror.launcher_meta);
                }
            }
        }

        const asset = {
            id: path.basename(filePath),
            url: url,
            path: filePath,
            algo: hash ? hash.algo : null,
            hash: hash ? hash.value : null,
            fallbackUrls: candidates
        };

        await downloadFile(asset);
        const content = await fs.readFile(filePath, 'utf8');
        return JSON.parse(content);
    }

    async loadVersionManifest() {
        const manifestPath = path.join(this.commonDir, 'version_manifest_v2.json');

        const candidates = [];
        if (MOJANG_MIRRORS && MOJANG_MIRRORS.length > 0) {
            for (const mirror of MOJANG_MIRRORS) {
                if (mirror.version_manifest) {
                    candidates.push(mirror.version_manifest);
                }
            }
        }

        const asset = {
            id: 'version_manifest_v2.json',
            url: MojangIndexProcessor.VERSION_MANIFEST_ENDPOINT,
            path: manifestPath,
            algo: null, // No hash verification for root manifest
            hash: null,
            fallbackUrls: candidates
        };

        try {
            await downloadFile(asset);
            const data = await fs.readFile(manifestPath, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            MojangIndexProcessor.logger.warn('Failed to download Mojang Version Manifest via DownloadEngine. Falling back to cache.', err);
            try {
                await fs.access(manifestPath);
                const data = await fs.readFile(manifestPath, 'utf8');
                return JSON.parse(data);
            } catch (e) {
                // If both network and cache fail, re-throw the original DownloadEngine error so `landing.js` can report it.
                throw err;
            }
        }
    }

    getAssetIndexPath(id) {
        return path.join(this.assetPath, 'indexes', `${id}.json`);
    }

    totalStages() {
        return 4;
    }

    async validate(onStageComplete) {
        const assets = await this.validateAssets(this.assetIndex);
        if (onStageComplete) await onStageComplete();
        const libraries = await this.validateLibraries(this.versionJson);
        if (onStageComplete) await onStageComplete();
        const client = await this.validateClient(this.versionJson);
        if (onStageComplete) await onStageComplete();
        const logConfig = await this.validateLogConfig(this.versionJson);
        if (onStageComplete) await onStageComplete();
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
                // Skip unnecessary language files (Only keep EN and RU)
                if (id.startsWith('minecraft/lang/')) {
                    const isEssential = id.endsWith('en_us.json') ||
                        id.endsWith('en_gb.json') ||
                        id.endsWith('ru_ru.json') ||
                        id.endsWith('en_us.lang') ||
                        id.endsWith('ru_ru.lang');
                    if (!isEssential) return null;
                }

                const hash = meta.hash;
                const filePath = path.join(objectDir, hash.substring(0, 2), hash);
                const url = `${MojangIndexProcessor.ASSET_RESOURCE_ENDPOINT}/${hash.substring(0, 2)}/${hash}`;

                const fallbackUrls = [];
                if (MOJANG_MIRRORS && MOJANG_MIRRORS.length > 0) {
                    for (const mirror of MOJANG_MIRRORS) {
                        if (mirror.assets) {
                            fallbackUrls.push(`${mirror.assets}/${hash.substring(0, 2)}/${hash}`);
                        }
                    }
                }

                if (!await validateLocalFile(filePath, HashAlgo.SHA1, hash)) {
                    return {
                        id,
                        hash,
                        algo: HashAlgo.SHA1,
                        size: meta.size,
                        url,
                        fallbackUrls,
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
                                fallbackUrls: MOJANG_MIRRORS.map(m => m.libraries ? artifact.url.replace('https://libraries.minecraft.net', m.libraries) : null).filter(Boolean), // Assuming libraries mirror logic if needed, or strict.
                                // Actually, libraries usually come from libraries.minecraft.net. 
                                // Ideally we should have a 'libraries' field in config? Or just use 'assets' generically?
                                // User request was generic. Let's stick to known overrides.
                                // If user provides a 'libraries' mirror key, we can use it.
                                // NOTE: Config example didn't have libraries.
                                // Leaving fallbackUrls empty for libraries unless we add it to config. 
                                // Wait, the user said "all mojang links". Libraries IS Mojang.
                                // I should probably treat 'libraries' same as 'assets' or add a specific key?
                                // Let's check the config again. 
                                // I added assets, version_manifest, launcher_meta.
                                // Libraries are often on libraries.minecraft.net.
                                // I will add 'libraries' to the logic if present.
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
                path: versionJarPath,
                fallbackUrls: MOJANG_MIRRORS.map(m => m.client ? versionJson.downloads.client.url.replace('https://piston-data.mojang.com', m.client) : null).filter(Boolean)
            }];
        }
        return [];
    }

    async validateLogConfig(versionJson) {
        if (!versionJson.logging || !versionJson.logging.client) return [];
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
