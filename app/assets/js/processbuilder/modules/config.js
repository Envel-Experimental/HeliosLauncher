const path = require('path')
const ConfigManager = require('../../configmanager') // Adjust path relative to this file's new location

class ProcessConfiguration {
    constructor(distroServer, vanillaManifest, modManifest, authUser, launcherVersion) {
        this.server = distroServer
        this.vanillaManifest = vanillaManifest
        this.modManifest = modManifest
        this.authUser = authUser
        this.launcherVersion = launcherVersion

        // Resolved paths
        this.gameDir = path.join(ConfigManager.getInstanceDirectory(), this.server.rawServer.id)
        this.commonDir = ConfigManager.getCommonDirectory()

        this.forgeModListFile = path.join(this.gameDir, 'forgeMods.list') // For MC 1.13+
        this.fmlDir = path.join(this.gameDir, 'forgeModList.json') // For MC < 1.13 Forge
        this.llDir = path.join(this.gameDir, 'liteloaderModList.json') // For MC < 1.13 LiteLoader
        this.libPath = path.join(this.commonDir, 'libraries')

        // State properties that might be derived from configuration or modules
        this.usingLiteLoader = false // Will be set by LiteLoader logic
        this.llPath = null // Will be set by LiteLoader logic
        this.usingFabricLoader = false // Will be set by Fabric logic/module check
    }

    getGameDirectory() {
        return this.gameDir
    }

    getCommonDirectory() {
        return this.commonDir
    }

    getServer() {
        return this.server
    }

    getVanillaManifest() {
        return this.vanillaManifest
    }

    getModManifest() {
        return this.modManifest
    }

    getAuthUser() {
        return this.authUser
    }

    getLauncherVersion() {
        return this.launcherVersion
    }

    getForgeModListFile() {
        return this.forgeModListFile
    }

    getFmlDirectory() { // Renamed from fmlDir to avoid confusion with a directory vs file
        return this.fmlDir
    }

    getLiteLoaderDirectory() { // Renamed from llDir
        return this.llDir
    }

    getLibraryPath() {
        return this.libPath
    }

    isUsingLiteLoader() {
        return this.usingLiteLoader
    }

    setUsingLiteLoader(value, path = null) {
        this.usingLiteLoader = value
        if (value && path) {
            this.llPath = path
        } else if (!value) {
            this.llPath = null
        }
    }

    getLiteLoaderPath() {
        return this.llPath
    }

    isUsingFabricLoader() {
        return this.usingFabricLoader
    }

    setUsingFabricLoader(value) {
        this.usingFabricLoader = value
    }
}

module.exports = ProcessConfiguration
