
const path = require('path');
const fs = require('fs');
const { fetchJson, handleFetchError, RestResponseStatus } = require('./network');
const { LoggerUtil, MavenUtil, mcVersionAtLeast, ensureEncodedPath, getMainServer } = require('./common');

const logger = LoggerUtil.getLogger('DistributionFactory');

class HeliosDistribution {
    constructor(rawDistribution, commonDir, instanceDir) {
        this.rawDistribution = rawDistribution;
        this.mainServerIndex = null;
        this.resolveMainServerIndex();
        this.servers = this.rawDistribution.servers.map(s => new HeliosServer(s, commonDir, instanceDir));
    }

    resolveMainServerIndex() {
        if (this.rawDistribution.servers.length > 0) {
            for (let i = 0; i < this.rawDistribution.servers.length; i++) {
                if (this.mainServerIndex == null) {
                    if (this.rawDistribution.servers[i].mainServer) {
                        this.mainServerIndex = i;
                    }
                } else {
                    this.rawDistribution.servers[i].mainServer = false;
                }
            }
            if (this.mainServerIndex == null) {
                this.mainServerIndex = 0;
                this.rawDistribution.servers[this.mainServerIndex].mainServer = true;
            }
        } else {
            logger.warn('Distribution has 0 configured servers. This doesnt seem right..');
            this.mainServerIndex = 0;
        }
    }

    getMainServer() {
        return this.mainServerIndex < this.servers.length ? this.servers[this.mainServerIndex] : null;
    }

    getServerById(id) {
        return this.servers.find(s => s.rawServer.id === id) || null;
    }
}

class HeliosServer {
    constructor(rawServer, commonDir, instanceDir) {
        this.rawServer = rawServer;
        const { hostname, port } = this.parseAddress();
        this.hostname = hostname;
        this.port = port;
        this.effectiveJavaOptions = this.parseEffectiveJavaOptions();
        this.modules = rawServer.modules.map(m => new HeliosModule(m, rawServer.id, commonDir, instanceDir));
    }

    parseAddress() {
        if (this.rawServer.address.includes(':')) {
            const pieces = this.rawServer.address.split(':');
            const port = Number(pieces[1]);

            if (!Number.isInteger(port)) {
                throw new Error(`Malformed server address for ${this.rawServer.id}. Port must be an integer!`);
            }

            return { hostname: pieces[0], port };
        } else {
            return { hostname: this.rawServer.address, port: 25565 };
        }
    }

    parseEffectiveJavaOptions() {
        const options = this.rawServer.javaOptions?.platformOptions ?? [];
        const mergeableProps = [];

        for (const option of options) {
            if (option.platform === process.platform) {
                if (option.architecture === process.arch) {
                    mergeableProps[0] = option;
                } else {
                    mergeableProps[1] = option;
                }
            }
        }
        mergeableProps[3] = {
            distribution: this.rawServer.javaOptions?.distribution,
            supported: this.rawServer.javaOptions?.supported,
            suggestedMajor: this.rawServer.javaOptions?.suggestedMajor
        };

        const merged = {};
        for (let i = mergeableProps.length - 1; i >= 0; i--) {
            if (mergeableProps[i] != null) {
                merged.distribution = mergeableProps[i].distribution;
                merged.supported = mergeableProps[i].supported;
                merged.suggestedMajor = mergeableProps[i].suggestedMajor;
            }
        }

        return this.defaultUndefinedJavaOptions(merged);
    }

    defaultUndefinedJavaOptions(props) {
        const [defaultRange, defaultSuggestion] = this.defaultJavaVersion();
        return {
            supported: props.supported ?? defaultRange,
            distribution: props.distribution ?? this.defaultJavaPlatform(),
            suggestedMajor: props.suggestedMajor ?? defaultSuggestion,
        };
    }

    defaultJavaVersion() {
        if (mcVersionAtLeast('1.20.5', this.rawServer.minecraftVersion)) {
            return ['>=21.x', 21];
        } else if (mcVersionAtLeast('1.17', this.rawServer.minecraftVersion)) {
            return ['>=17.x', 17];
        } else {
            return ['8.x', 8];
        }
    }

    defaultJavaPlatform() {
        return process.platform === 'darwin' ? 'corretto' : 'temurin';
    }
}

class HeliosModule {
    constructor(rawModule, serverId, commonDir, instanceDir) {
        this.rawModule = rawModule;
        this.serverId = serverId;
        this.subModules = [];

        this.mavenComponents = this.resolveMavenComponents();
        this.required = this.resolveRequired();
        this.localPath = this.resolveLocalPath(commonDir, instanceDir);

        if (this.rawModule.subModules != null) {
            this.subModules = this.rawModule.subModules.map(m => new HeliosModule(m, serverId, commonDir, instanceDir));
        }
    }

    resolveMavenComponents() {
        // Files need not have a maven identifier if they provide a path.
        if (this.rawModule.type === 'file' && this.rawModule.artifact.path != null) {
            return null;
        }
        // Version Manifests never provide a maven identifier.
        if (this.rawModule.type === 'VersionManifest') {
            return null;
        }

        const isMavenId = MavenUtil.isMavenIdentifier(this.rawModule.id);

        if (!isMavenId) {
            if (this.rawModule.type !== 'file') {
                throw new Error(`Module ${this.rawModule.name} (${this.rawModule.id}) of type ${this.rawModule.type} must have a valid maven identifier!`);
            } else {
                throw new Error(`Module ${this.rawModule.name} (${this.rawModule.id}) of type ${this.rawModule.type} must either declare an artifact path or have a valid maven identifier!`);
            }
        }

        try {
            return MavenUtil.getMavenComponents(this.rawModule.id);
        } catch (err) {
            throw new Error(`Failed to resolve maven components for module ${this.rawModule.name} (${this.rawModule.id}) of type ${this.rawModule.type}. Reason: ${err.message}`);
        }
    }

    resolveRequired() {
        if (this.rawModule.required == null) {
            return {
                value: true,
                def: true
            };
        } else {
            return {
                value: this.rawModule.required.value ?? true,
                def: this.rawModule.required.def ?? true
            };
        }
    }

    resolveLocalPath(commonDir, instanceDir) {
        // Version Manifests have a pre-determined path.
        if (this.rawModule.type === 'VersionManifest') {
            return ensureEncodedPath(path.join(commonDir, 'versions', this.rawModule.id, `${this.rawModule.id}.json`));
        }

        const relativePath = this.rawModule.artifact.path ?? MavenUtil.mavenComponentsAsNormalizedPath(
            this.mavenComponents.group,
            this.mavenComponents.artifact,
            this.mavenComponents.version,
            this.mavenComponents.classifier,
            this.mavenComponents.extension
        );

        switch (this.rawModule.type) {
            case 'Library':
            case 'Forge':
            case 'ForgeHosted':
            case 'Fabric':
            case 'LiteLoader':
                return ensureEncodedPath(path.join(commonDir, 'libraries', relativePath));
            case 'ForgeMod':
            case 'LiteMod':
                return ensureEncodedPath(path.join(commonDir, 'modstore', relativePath));
            case 'FabricMod':
                return ensureEncodedPath(path.join(commonDir, 'mods', 'fabric', relativePath));
            case 'file':
            default:
                return ensureEncodedPath(path.join(instanceDir, this.serverId, relativePath));
        }
    }

    hasMavenComponents() {
        return this.mavenComponents != null;
    }

    getMavenComponents() {
        return this.mavenComponents;
    }

    getRequired() {
        return this.required;
    }

    getPath() {
        return this.localPath;
    }

    getMavenIdentifier() {
        return MavenUtil.mavenComponentsToIdentifier(
            this.mavenComponents.group,
            this.mavenComponents.artifact,
            this.mavenComponents.version,
            this.mavenComponents.classifier,
            this.mavenComponents.extension
        );
    }

    getExtensionlessMavenIdentifier() {
        return MavenUtil.mavenComponentsToExtensionlessIdentifier(
            this.mavenComponents.group,
            this.mavenComponents.artifact,
            this.mavenComponents.version,
            this.mavenComponents.classifier
        );
    }

    getVersionlessMavenIdentifier() {
        return MavenUtil.mavenComponentsToVersionlessIdentifier(
            this.mavenComponents.group,
            this.mavenComponents.artifact,
            this.mavenComponents.classifier
        );
    }

    hasSubModules() {
        return this.subModules.length > 0;
    }
}

// DistributionAPI
const apiLogger = LoggerUtil.getLogger('DistributionAPI');

// Utility for retry logic (Simple version to avoid dependency if needed, or stick to what was patched)
async function retry(fn, retries = 3, delay = 1000, condition = null) {
    try {
        return await fn();
    } catch (err) {
        if (retries > 0 && (condition == null || condition(err))) {
            await new Promise(resolve => setTimeout(resolve, delay));
            return retry(fn, retries - 1, delay, condition);
        }
        throw err;
    }
}

class DistributionAPI {

    static log = apiLogger;
    DISTRO_FILE = 'distribution.json';
    DISTRO_FILE_DEV = 'distribution_dev.json';

    constructor(
        launcherDirectory,
        commonDir,
        instanceDir,
        remoteUrl,
        devMode
    ) {
        this.launcherDirectory = launcherDirectory;
        this.commonDir = commonDir;
        this.instanceDir = instanceDir;
        this.remoteUrl = remoteUrl;
        this.devMode = devMode;

        this.distroPath = path.resolve(launcherDirectory, this.DISTRO_FILE);
        this.distroDevPath = path.resolve(launcherDirectory, this.DISTRO_FILE_DEV);

        this._remoteFailed = false; // Added property for tracking failures
    }

    async getDistribution() {
        // PATCH: Wrapped with retry logic
        const FAILED_DOWNLOAD_ERROR_CODE = 1; // Assuming RestResponseStatus.ERROR or similar?
        // Actually, request errors usually throw in original 'got'.
        // In our fetch wrapper, errors are thrown.
        // We will wrap the internal load logic.

        // Original logic:
        /*
        if(this.rawDistribution == null) {
            this.rawDistribution = await this.loadDistribution()
            this.distribution = new HeliosDistribution(this.rawDistribution, this.commonDir, this.instanceDir)
        }
        return this.distribution
        */

        const realGetDistribution = async () => {
            if (this.rawDistribution == null) {
                this.rawDistribution = await this.loadDistribution();
                this.distribution = new HeliosDistribution(this.rawDistribution, this.commonDir, this.instanceDir);
            }
            return this.distribution;
        };

        return await retry(
            realGetDistribution,
            3,
            2000,
            (err) => {
                // If the error suggests a network failure, retry.
                // Our fetch wrapper throws errors.
                return true;
            }
        ).catch((err) => {
            console.error('Failed to download distribution index after multiple retries.', err);
            return null;
        });
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
        } else {
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
            const remoteRes = await this.pullRemote();
            distro = remoteRes.data;
            if (distro == null) {
                distro = await this.pullLocal();
            } else {
                await this.writeDistributionToDisk(distro);
            }
        } else {
            distro = await this.pullLocal();
        }

        return distro;
    }

    async pullRemote() {
        // PATCH: Wrapped to set _remoteFailed
        try {
            const res = await this._pullRemoteInternal();
            if (res.data == null) {
                this._remoteFailed = true;
            } else {
                this._remoteFailed = false;
            }
            return res;
        } catch (err) {
            this._remoteFailed = true;
            throw err;
        }
    }

    async _pullRemoteInternal() {
        try {
            const res = await fetchJson(this.remoteUrl, {
                responseType: 'json',
                timeout: {
                    connect: 15000
                }
            });

            return {
                data: res.body,
                responseStatus: RestResponseStatus.SUCCESS
            };

        } catch (error) {
            return handleFetchError('Pull Remote', error, DistributionAPI.log, () => null);
        }
    }

    async writeDistributionToDisk(distribution) {
        await fs.promises.writeFile(this.distroPath, JSON.stringify(distribution, null, 4));
    }

    async pullLocal() {
        return await this.readDistributionFromFile(!this.devMode ? this.distroPath : this.distroDevPath);
    }

    async readDistributionFromFile(filePath) {
        try {
            await fs.promises.access(filePath);
            const raw = await fs.promises.readFile(filePath, 'utf-8');
            try {
                return JSON.parse(raw);
            } catch (error) {
                DistributionAPI.log.error(`Malformed distribution file at ${filePath}`);
                return null;
            }
        } catch (e) {
            DistributionAPI.log.error(`No distribution file found at ${filePath}!`);
            return null;
        }
    }
}

module.exports = {
    DistributionAPI,
    HeliosDistribution,
    HeliosServer,
    HeliosModule
};
