/* global process */
const path = require('path')
const os = require('os')
const fs = require('fs/promises')
const { extractZip } = require('../common/FileUtils')
const { LoggerUtil } = require('../util/LoggerUtil')
const { getMojangOS, isLibraryCompatible, mcVersionAtLeast } = require('../common/MojangUtils')
const { Type } = require('../common/DistributionClasses')
const ConfigManager = require('../../configmanager')

const logger = LoggerUtil.getLogger('LaunchArgumentBuilder')

/**
 * Module responsible for constructing the JVM arguments and Classpath.
 * 
 * Responsibilities:
 * 1. Resolving JVM arguments for different Minecraft versions (1.12 vs 1.13+).
 * 2. Building the Classpath from Mojang libraries and Server libraries.
 * 3. Extracting Native libraries (dll/so/dylib) to a temp directory.
 * 4. Sanitizing JVM flags (e.g. Removing CMS, adding G1GC).
 */
class LaunchArgumentBuilder {

    /**
     * @param {Object} server The server distribution object.
     * @param {Object} vanillaManifest The vanilla Minecraft manifest.
     * @param {Object} modManifest The mod loader manifest (Forge/Fabric).
     * @param {Object} authUser The authenticated user object.
     * @param {string} launcherVersion The current version of the launcher.
     * @param {string} gameDir The absolute path to the game instance directory.
     * @param {string} commonDir The absolute path to the common directory.
     */
    constructor(server, vanillaManifest, modManifest, authUser, launcherVersion, gameDir, commonDir) {
        this.server = server
        this.vanillaManifest = vanillaManifest
        this.modManifest = modManifest
        this.authUser = authUser
        this.launcherVersion = launcherVersion
        this.gameDir = gameDir
        this.commonDir = commonDir
        this.libPath = path.join(commonDir, 'libraries')
    }

    /**
     * Get the platform specific classpath separator.
     * 
     * @returns {string} ';' for Windows, ':' for Unix.
     */
    static getClasspathSeparator() {
        return process.platform === 'win32' ? ';' : ':'
    }

    /**
     * Construct the full array of JVM arguments for the process.
     * 
     * @param {Array.<Object>} mods The list of enabled mods.
     * @param {string} tempNativePath The path where native libraries are extracted.
     * @param {boolean} usingFabricLoader Whether Fabric is being used.
     * @param {boolean} usingLiteLoader Whether LiteLoader is being used.
     * @param {string} llPath The path to the LiteLoader jar (if applicable).
     * @returns {Array.<string>} The complete array of JVM arguments.
     */
    async constructJVMArguments(mods, tempNativePath, usingFabricLoader, usingLiteLoader, llPath) {
        if (mcVersionAtLeast('1.13', this.server.rawServer.minecraftVersion)) {
            return await this._constructJVMArguments113(mods, tempNativePath, usingFabricLoader)
        } else {
            return await this._constructJVMArguments112(mods, tempNativePath, usingLiteLoader, llPath)
        }
    }

    /**
     * Internal method to construct arguments for Minecraft 1.12 and older.
     */
    async _constructJVMArguments112(mods, tempNativePath, usingLiteLoader, llPath) {
        let args = []

        // Classpath Argument
        args.push('-cp')
        args.push((await this.classpathArg(mods, tempNativePath, usingLiteLoader, llPath, false)).join(LaunchArgumentBuilder.getClasspathSeparator()))

        // Dock Icon for macOS
        if (process.platform === 'darwin') {
            args.push('-Xdock:name=FLauncher')
            args.push('-Xdock:icon=' + path.join(__dirname, '..', '..', 'images', 'minecraft.icns'))
        }

        // Memory Settings
        args.push('-Xmx' + ConfigManager.getMaxRAM(this.server.rawServer.id))
        args.push('-Xms' + ConfigManager.getMinRAM(this.server.rawServer.id))

        // Sanitize and append GC/Performance flags
        args = args.concat(this._resolveSanitizedJMArgs(args))
        args.push('-Djava.library.path=' + tempNativePath)

        // Main Java Class
        args.push(this.modManifest.mainClass)

        // Forge Arguments
        args = args.concat(this._resolveForgeArgs(usingLiteLoader, llPath))

        return args
    }

    /**
     * Internal method to construct arguments for Minecraft 1.13 and newer.
     */
    async _constructJVMArguments113(mods, tempNativePath, usingFabricLoader) {
        const argDiscovery = /\${*(.*)}/

        // Start with JVM arguments from Vanilla Manifest
        let args = [...this.vanillaManifest.arguments.jvm]

        // Append ModLoader JVM arguments
        if (this.modManifest.arguments.jvm != null) {
            for (const argStr of this.modManifest.arguments.jvm) {
                args.push(argStr
                    .replaceAll('${library_directory}', this.libPath)
                    .replaceAll('${classpath_separator}', LaunchArgumentBuilder.getClasspathSeparator())
                    .replaceAll('${version_name}', this.modManifest.id)
                )
            }
        }

        // Dock Icon for macOS
        if (process.platform === 'darwin') {
            args.push('-Xdock:name=FLauncher')
            args.push('-Xdock:icon=' + path.join(__dirname, '..', '..', 'images', 'minecraft.icns'))
        }

        // Memory Settings
        args.push('-Xmx' + ConfigManager.getMaxRAM(this.server.rawServer.id))
        args.push('-Xms' + ConfigManager.getMinRAM(this.server.rawServer.id))
        args = args.concat(this._resolveSanitizedJMArgs(args))

        // Main Java Class
        args.push(this.modManifest.mainClass)

        // Vanilla Arguments
        args = args.concat(this.vanillaManifest.arguments.game)

        // Process Argument Rules (Allow/Disallow based on OS/Features)
        for (let i = 0; i < args.length; i++) {
            if (typeof args[i] === 'object' && args[i].rules != null) {
                let checksum = 0
                for (let rule of args[i].rules) {
                    if (rule.os != null) {
                        if (rule.os.name === getMojangOS()
                            && (rule.os.version == null || new RegExp(rule.os.version).test(os.release))) {
                            if (rule.action === 'allow') checksum++
                        } else {
                            if (rule.action === 'disallow') checksum++
                        }
                    } else if (rule.features != null) {
                        if (rule.features.has_custom_resolution && ConfigManager.getFullscreen()) {
                            args[i].value = ['--fullscreen', 'true']
                            checksum++
                        }
                    }
                }
                if (checksum === args[i].rules.length) {
                    if (typeof args[i].value === 'string') {
                        args[i] = args[i].value
                    } else if (typeof args[i].value === 'object') {
                        args.splice(i, 1, ...args[i].value)
                    }
                    i--
                } else {
                    args[i] = null
                }
            } else if (typeof args[i] === 'string') {
                // Replace placeholders
                if (argDiscovery.test(args[i])) {
                    const identifier = args[i].match(argDiscovery)[1]
                    let val = null
                    switch (identifier) {
                        case 'auth_player_name': val = this.authUser.displayName.trim(); break;
                        case 'version_name': val = this.server.rawServer.id; break;
                        case 'game_directory': val = this.gameDir; break;
                        case 'assets_root': val = path.join(this.commonDir, 'assets'); break;
                        case 'assets_index_name': val = this.vanillaManifest.assets; break;
                        case 'auth_uuid': val = this.authUser.uuid.trim(); break;
                        case 'auth_access_token': val = this.authUser.accessToken; break;
                        case 'user_type': val = this.authUser.type === 'microsoft' ? 'msa' : 'mojang'; break;
                        case 'version_type': val = this.vanillaManifest.type; break;
                        case 'resolution_width': val = ConfigManager.getGameWidth(); break;
                        case 'resolution_height': val = ConfigManager.getGameHeight(); break;
                        case 'natives_directory': val = args[i].replace(argDiscovery, tempNativePath); break;
                        case 'launcher_name': val = args[i].replace(argDiscovery, 'FLauncher'); break;
                        case 'launcher_version': val = args[i].replace(argDiscovery, this.launcherVersion); break;
                        case 'classpath': val = (await this.classpathArg(mods, tempNativePath, false, null, usingFabricLoader)).join(LaunchArgumentBuilder.getClasspathSeparator()); break;
                    }
                    if (val != null) args[i] = val
                }
            }
        }

        this._processAutoConnectArg(args)
        args = args.concat(this.modManifest.arguments.game)
        return args.filter(arg => arg != null)
    }

    /**
     * Removes deprecated JVM flags (CMS) and ensures valid GC flags (G1GC) are present.
     * 
     * @param {Array.<string>} currentArgs The current list of arguments.
     * @returns {Array.<string>} Sanitized extra JVM options.
     */
    _resolveSanitizedJMArgs(currentArgs) {
        const forbidden = ['-XX:+UseConcMarkSweepGC', '-XX:+CMSIncrementalMode']
        const gcFlags = ['-XX:+UseG1GC', '-XX:+UseSerialGC', '-XX:+UseParallelGC', '-XX:+UseZGC', '-XX:+UseShenandoahGC']
        let args = ConfigManager.getJVMOptions(this.server.rawServer.id) || []

        // Filter out forbidden flags
        args = args.filter(arg => !forbidden.includes(arg))

        // Check if any GC is present, otherwise default to G1GC
        const hasGC = args.some(arg => gcFlags.includes(arg)) || currentArgs.some(arg => gcFlags.includes(arg))
        if (!hasGC) args.push('-XX:+UseG1GC')

        return args
    }

    /**
     * Resolves the arguments required by Forge.
     */
    _resolveForgeArgs(usingLiteLoader, llDir) {
        const mcArgs = this.modManifest.minecraftArguments.split(' ')
        const argDiscovery = /\${*(.*)}/
        for (let i = 0; i < mcArgs.length; ++i) {
            if (argDiscovery.test(mcArgs[i])) {
                const identifier = mcArgs[i].match(argDiscovery)[1]
                let val = null
                switch (identifier) {
                    case 'auth_player_name': val = this.authUser.displayName.trim(); break;
                    case 'version_name': val = this.server.rawServer.id; break;
                    case 'game_directory': val = this.gameDir; break;
                    case 'assets_root': val = path.join(this.commonDir, 'assets'); break;
                    case 'assets_index_name': val = this.vanillaManifest.assets; break;
                    case 'auth_uuid': val = this.authUser.uuid.trim(); break;
                    case 'auth_access_token': val = this.authUser.accessToken; break;
                    case 'user_type': val = this.authUser.type === 'microsoft' ? 'msa' : 'mojang'; break;
                    case 'user_properties': val = '{}'; break;
                    case 'version_type': val = this.vanillaManifest.type; break;
                }
                if (val != null) mcArgs[i] = val
            }
        }
        this._processAutoConnectArg(mcArgs)

        if (ConfigManager.getFullscreen()) {
            mcArgs.push('--fullscreen', true)
        } else {
            mcArgs.push('--width', ConfigManager.getGameWidth(), '--height', ConfigManager.getGameHeight())
        }

        // REFACTOR NOTE: Legacy '--modListFile' argument is handled by the caller (ProcessBuilder)
        // because it involves path logic best resolved at that level.

        return mcArgs
    }

    /**
     * Helper to inject auto-connect arguments if enabled.
     */
    _processAutoConnectArg(args) {
        if (ConfigManager.getAutoConnect() && this.server.rawServer.autoconnect) {
            if (mcVersionAtLeast('1.20', this.server.rawServer.minecraftVersion)) {
                args.push('--quickPlayMultiplayer', `${this.server.hostname}:${this.server.port}`)
            } else {
                args.push('--server', this.server.hostname, '--port', this.server.port)
            }
        }
    }

    /**
     * Build the classpath array.
     * 
     * @param {Array.<Object>} mods Enabled mods.
     * @param {string} tempNativePath Path for native extraction.
     * @param {boolean} usingLiteLoader usage flag.
     * @param {string} llPath LiteLoader path.
     * @param {boolean} usingFabricLoader usage flag.
     * @returns {Array.<string>} The array of paths for the classpath.
     */
    async classpathArg(mods, tempNativePath, usingLiteLoader, llPath, usingFabricLoader) {
        let cpArgs = []

        // Add Version Jar (Mojang) - Not needed for Forge 1.17+
        if (!mcVersionAtLeast('1.17', this.server.rawServer.minecraftVersion) || usingFabricLoader) {
            const version = this.vanillaManifest.id
            cpArgs.push(path.join(this.commonDir, 'versions', version, version + '.jar'))
        }
        if (usingLiteLoader) cpArgs.push(llPath)

        // Resolve Libraries
        const mojangLibs = await this._resolveMojangLibraries(tempNativePath)
        const servLibs = this._resolveServerLibraries(mods)
        const finalLibs = { ...mojangLibs, ...servLibs }
        cpArgs = cpArgs.concat(Object.values(finalLibs))

        // Clean up paths (remove trailing jar if duplicated or malformed)
        const ext = '.jar'
        for (let i = 0; i < cpArgs.length; i++) {
            const extIndex = cpArgs[i].lastIndexOf(ext)
            if (extIndex > -1 && extIndex !== cpArgs[i].length - ext.length) {
                cpArgs[i] = cpArgs[i].substring(0, extIndex + ext.length)
            }
        }
        return cpArgs
    }

    /**
     * Resolve and extract Mojang declared libraries.
     */
    async _resolveMojangLibraries(tempNativePath) {
        const nativesRegex = /.+:natives-([^-]+)(?:-(.+))?/
        const libs = {}
        const libArr = this.vanillaManifest.libraries

        await fs.mkdir(tempNativePath, { recursive: true })

        // Dynamic import for ESM p-limit
        const { default: pLimit } = await import('p-limit')
        const limit = pLimit(8) // Concurrency 8

        // Track items to clean up after extraction to avoid race conditions (EPERM/ENOTEMPTY)
        // Access to this set must be synchronized or just pushing is fine in JS event loop (single threaded)
        // Set to avoid duplicates
        const globalExclusions = new Set()

        const tasks = libArr.map(lib => {
            return limit(async () => {
                if (!isLibraryCompatible(lib.rules, lib.natives)) return

                let exclusions = []
                if (lib.natives != null) {
                    exclusions = await this._extractNative(lib, tempNativePath)
                } else if (lib.name.includes('natives-')) {
                    exclusions = await this._extractNativeNew(lib, tempNativePath, nativesRegex)
                } else {
                    const dlInfo = lib.downloads
                    const artifact = dlInfo.artifact
                    const to = path.join(this.libPath, artifact.path)
                    const versionIndependentId = lib.name.substring(0, lib.name.lastIndexOf(':'))
                    libs[versionIndependentId] = to
                }

                if (exclusions) {
                    exclusions.forEach(e => globalExclusions.add(e))
                }
            })
        })

        await Promise.all(tasks)

        // Post-Extraction Cleanup (Synchronized)
        // Remove META-INF and other exclusions *after* all files are extracted.
        for (const item of globalExclusions) {
            const target = path.join(tempNativePath, item)
            // Force remove, ignore errors if already gone
            try {
                await fs.rm(target, { recursive: true, force: true })
            } catch (e) {
                logger.warn('Failed to clean up native exclusion:', target, e)
            }
        }

        return libs
    }

    async _extractNative(lib, tempNativePath) {
        const exclusionArr = lib.extract != null ? lib.extract.exclude : ['META-INF/']
        const artifact = lib.downloads.classifiers[lib.natives[getMojangOS()].replace('${arch}', process.arch.replace('x', ''))]
        const to = path.join(this.libPath, artifact.path)
        await this._unzip(to, tempNativePath)
        return exclusionArr
    }

    async _extractNativeNew(lib, tempNativePath, nativesRegex) {
        const regexTest = nativesRegex.exec(lib.name)
        const arch = regexTest[2] ?? 'x64'
        if (arch != process.arch) return null

        const exclusionArr = lib.extract != null ? lib.extract.exclude : ['META-INF/', '.git', '.sha1']
        const artifact = lib.downloads.artifact
        const to = path.join(this.libPath, artifact.path)

        await this._unzip(to, tempNativePath)
        return exclusionArr
    }

    async _unzip(zipPath, dest) {
        try {
            await extractZip(zipPath, dest)
        } catch (e) {
            logger.error('Error extracting native:', e)
        }
    }

    /**
     * Resolve libraries declared by the server/mods.
     */
    _resolveServerLibraries(mods) {
        const mdls = this.server.modules
        let libs = {}

        // 1. Resolve from Server Modules
        for (let mdl of mdls) {
            const type = mdl.rawModule.type
            if (type === Type.ForgeHosted || type === Type.Fabric || type === Type.Library) {
                libs[mdl.getVersionlessMavenIdentifier()] = mdl.getPath()
                if (mdl.subModules.length > 0) {
                    libs = { ...libs, ...this._resolveModuleLibraries(mdl) }
                }
            }
        }

        // 2. Resolve from Enabled Mods
        for (let i = 0; i < mods.length; i++) {
            // Corrected logic to check subModules on the mod object
            if (mods[i].subModules && mods[i].subModules.length > 0) {
                libs = { ...libs, ...this._resolveModuleLibraries(mods[i]) }
            }
        }
        return libs
    }

    _resolveModuleLibraries(mdl) {
        if (mdl.subModules.length === 0) return {}
        let libs = {}
        for (let sm of mdl.subModules) {
            if (sm.rawModule.type === Type.Library && (sm.rawModule.classpath ?? true)) {
                libs[sm.getVersionlessMavenIdentifier()] = sm.getPath()
            }
            if (sm.subModules.length > 0) {
                libs = { ...libs, ...this._resolveModuleLibraries(sm) }
            }
        }
        return libs
    }

}
module.exports = LaunchArgumentBuilder
