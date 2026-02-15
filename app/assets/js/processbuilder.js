/* global process */
const child_process = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')


// Line 67: fs.ensureDirSync(this.gameDir) -> fs.mkdirSync(this.gameDir, { recursive: true })
// Line 155: fs.existsSync(ll.getPath()) -> fs.existsSync(ll.getPath()) (Native supports this)
// Line 182: fs.ensureDirSync(nativeBasePath) -> fs.mkdirSync(nativeBasePath, { recursive: true })
// Line 195: fs.remove(tempNativePath) -> fs.promises.rm(tempNativePath, { recursive: true, force: true })

// I will do multiple replacements in one go if possible or use multiple blocks.
// Wait, replace_file_content is for SINGLE CONTIGUOUS block.
// The file has imports at top, and usages scattered.
// I will use multi_replace for this file if it's widely used, or just replace the imports and then specific lines.
// But I have `replace_file_content` available. I'll use `multi_replace_file_content` if I had it, but standard policy says "Use this tool ONLY when you are making MULTIPLE, NON-CONTIGUOUS edits". Yes I should use `multi_replace` here.


const { LoggerUtil } = require('./core/util/LoggerUtil')
const { Type } = require('./core/common/DistributionClasses')
const { mcVersionAtLeast } = require('./core/common/MojangUtils')
const pathutil = require('./pathutil')
const ConfigManager = require('./configmanager')

// New Modules
const ModConfigResolver = require('./core/game/ModConfigResolver')
const LaunchArgumentBuilder = require('./core/game/LaunchArgumentBuilder')
const GameCrashHandler = require('./core/game/GameCrashHandler')

const logger = LoggerUtil.getLogger('ProcessBuilder')

/**
 * Orchestrator class for the Minecraft launch process.
 * 
 * Responsibilities:
 * 1. Coordinating the launch steps: Mod resolution, Argument building, Process spawning.
 * 2. Managing the lifecycle of the game process.
 * 3. Handling process output logging.
 * 4. Delegating specific tasks to specialized helper classes.
 */
class ProcessBuilder {

    /**
     * @param {Object} distroServer The server distribution object.
     * @param {Object} vanillaManifest The vanilla Minecraft manifest.
     * @param {Object} modManifest The mod loader manifest.
     * @param {Object} authUser The authenticated user.
     * @param {string} launcherVersion The launcher version.
     */
    constructor(distroServer, vanillaManifest, modManifest, authUser, launcherVersion) {
        this.server = distroServer
        this.vanillaManifest = vanillaManifest
        this.modManifest = modManifest
        this.authUser = authUser
        this.launcherVersion = launcherVersion

        // Paths
        this.gameDir = path.join(ConfigManager.getInstanceDirectory(), distroServer.rawServer.id)
        this.commonDir = ConfigManager.getCommonDirectory()
        this.libPath = path.join(this.commonDir, 'libraries')

        // State
        this.usingLiteLoader = false
        this.usingFabricLoader = false
        this.llPath = null

        // Helpers
        this.modResolver = new ModConfigResolver(this.server, this.modManifest, this.commonDir)
        this.argBuilder = new LaunchArgumentBuilder(this.server, this.vanillaManifest, this.modManifest, this.authUser, this.launcherVersion, this.gameDir, this.commonDir)
    }

    /**
     * Main method to build and spawn the Minecraft process.
     * 
     * @returns {ChildProcess} The spawned child process.
     */
    async build() {
        fs.mkdirSync(this.gameDir, { recursive: true })
        const tempNativePath = this._setupTempNatives()

        // 1. Resolve Mods
        this._setupLoaders()
        const modObj = this.modResolver.resolveModConfiguration(
            ConfigManager.getModConfiguration(this.server.rawServer.id).mods,
            this.server.modules
        )

        // 2. Write Mod Lists (Pre-1.13)
        if (!mcVersionAtLeast('1.13', this.server.rawServer.minecraftVersion)) {
            const fmlDir = path.join(this.gameDir, 'forgeModList.json')
            const llDir = path.join(this.gameDir, 'liteloaderModList.json')

            this.modResolver.constructJSONModList('forge', modObj.fMods, fmlDir, llDir, true)
            if (this.usingLiteLoader) {
                this.modResolver.constructJSONModList('liteloader', modObj.lMods, fmlDir, llDir, true)
            }
        }

        // 3. Construct Arguments
        let args = await this.argBuilder.constructJVMArguments(
            modObj.fMods.concat(modObj.lMods),
            tempNativePath,
            this.usingFabricLoader,
            this.usingLiteLoader,
            this.llPath
        )

        // 4. Mod List (1.13+)
        if (mcVersionAtLeast('1.13', this.server.rawServer.minecraftVersion)) {
            const forgeModListFile = path.join(this.gameDir, 'forgeMods.list')
            const modArgs = this.modResolver.constructModList(modObj.fMods, forgeModListFile, this.usingFabricLoader)
            args = args.concat(modArgs)
        }

        // 5. Appending Legacy Forge Args
        if (!mcVersionAtLeast('1.13', this.server.rawServer.minecraftVersion)) {
            const fmlDir = path.join(this.gameDir, 'forgeModList.json')
            args.push('--modListFile')
            if (this.modResolver._lteMinorVersion(9)) {
                args.push(path.basename(fmlDir))
            } else {
                args.push('absolute:' + fmlDir)
            }
        }

        logger.info('Launch Arguments:', args)

        // 6. Spawn Process
        const child = child_process.spawn(ConfigManager.getJavaExecutable(this.server.rawServer.id), args, {
            cwd: this.gameDir,
            detached: ConfigManager.getLaunchDetached()
        })

        if (ConfigManager.getLaunchDetached()) {
            child.unref()
        }

        this._setupLogging(child)

        // 7. Handle Exit / Crash
        // We defer this entirely to GameCrashHandler
        const crashHandler = new GameCrashHandler(this.gameDir, this.commonDir, this.server, this.logBuffer)

        child.on('close', async (code, signal) => {
            // Cleanup Natives
            this._cleanupTempNatives(tempNativePath)
            // Handle Crash UI
            await crashHandler.handleExit(code)
        })

        return child
    }

    /**
     * Determine which mod loaders (LiteLoader, Fabric) are being used.
     */
    _setupLoaders() {
        // LiteLoader
        for (let ll of this.server.modules) {
            if (ll.rawModule.type === Type.LiteLoader) {
                const req = ll.getRequired()
                const modCfg = ConfigManager.getModConfiguration(this.server.rawServer.id).mods
                const enabled = ModConfigResolver.isModEnabled(modCfg[ll.getVersionlessMavenIdentifier()], req)

                if ((!req.value && enabled) || req.value) {
                    if (fs.existsSync(ll.getPath())) {
                        this.usingLiteLoader = true
                        this.llPath = ll.getPath()
                    }
                }
            }
        }
        logger.info('Using liteloader:', this.usingLiteLoader)

        // Fabric
        this.usingFabricLoader = this.server.modules.some(mdl => mdl.rawModule.type === Type.Fabric)
        logger.info('Using fabric loader:', this.usingFabricLoader)
    }

    /**
     * Setup a temporary directory for native library extraction.
     */
    _setupTempNatives() {
        const currentSystemTemp = os.tmpdir()
        let nativeBasePath = currentSystemTemp
        const fallbackPath = pathutil.getFallbackDataPath()
        const isUsingFallback = this.commonDir.startsWith(fallbackPath)
        const isWindows = process.platform === 'win32'

        if ((isWindows && currentSystemTemp.includes('~')) || !pathutil.isPathValid(currentSystemTemp) || isUsingFallback) {
            nativeBasePath = path.join(fallbackPath, 'temp_natives')
            try {
                fs.mkdirSync(nativeBasePath, { recursive: true })
            } catch (err) {
                nativeBasePath = currentSystemTemp
            }
        }
        return path.join(nativeBasePath, ConfigManager.getTempNativeFolder(), crypto.pseudoRandomBytes(16).toString('hex'))
    }

    /**
     * Clean up the temporary native directory after process exit.
     */
    _cleanupTempNatives(tempNativePath) {
        try {
            fs.promises.rm(tempNativePath, { recursive: true, force: true }).catch(err => logger.warn('Failed to clean temp natives', err))
        } catch (e) {
            // ignore
        }
    }

    /**
     * Pipe process output to logger and internal memory buffer for crash analysis.
     */
    _setupLogging(child) {
        this.logBuffer = []
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')

        const handleLog = (data, isErr) => {
            const lines = data.trim().split('\n')
            lines.forEach(x => {
                const color = isErr ? '\x1b[31m' : '\x1b[32m'
                console.log(`${color}[Minecraft]\x1b[0m ${x}`)

                // Keep last 1000 lines for crash analysis
                this.logBuffer.push(x)
                if (this.logBuffer.length > 1000) this.logBuffer.shift()
            })
        }

        child.stdout.on('data', d => handleLog(d, false))
        child.stderr.on('data', d => handleLog(d, true))
    }

    /**
     * Get class path separator for the current platform.
     */
    static getClasspathSeparator() {
        return process.platform === 'win32' ? ';' : ':'
    }
}

module.exports = ProcessBuilder
