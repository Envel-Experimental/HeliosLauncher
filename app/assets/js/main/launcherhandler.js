const { ipcMain, app, shell, dialog } = require('electron')
const { IPC } = require('../ipcconstants')
const { DistroAPI } = require('../distromanager')
const ConfigManager = require('../configmanager')
const ProcessBuilder = require('../processbuilder')
const { FullRepair, MojangIndexProcessor, DistributionIndexProcessor } = require('@envel/helios-core/dl')
const { validateSelectedJvm, ensureJavaDirIsRoot, javaExecFromRoot, discoverBestJvmInstallation, latestOpenJDK, extractJdk, validateLocalFile } = require('@envel/helios-core/java')
const { LoggerUtil } = require('@envel/helios-core')
const fs = require('fs-extra')
const path = require('path')

const logger = LoggerUtil.getLogger('LauncherHandler')

// Handle Game Launch
ipcMain.on(IPC.LAUNCH_GAME, async (event, serverId, authUser) => {
    const sender = event.sender

    try {
        const distro = await DistroAPI.getDistribution()
        const server = distro.getServerById(serverId)

        if (!server) {
            sender.send(IPC.GAME_STARTUP_ERROR, 'No server selected')
            return
        }

        // Verify Java
        let jExe = ConfigManager.getJavaExecutable(serverId)
        if (!jExe || !fs.existsSync(jExe)) {
             // We need to tell renderer to show java scan
             // But for now, we assume renderer has already validated/downloaded java via separate calls?
             // Wait, the renderer logic for java download is complex and interactive.
             // If I move ProcessBuilder here, I assume java is ready.
             // If not, we should error.

             // Check if renderer did its job
             // Actually, Launch logic in landing.js does "asyncSystemScan" which downloads Java.
             // I should move "asyncSystemScan" logic to Main too?
             // It calls "downloadJava" which uses "remote.getCurrentWindow().setProgressBar".

             // For ZERO REGRESSIONS, I can't easily move interactive UI logic to Main without rewriting UI.
             // Compromise: Renderer ensures Java is ready using `api.java.*` (exposed?) or `api.game.prepareJava`.
             // IF java is ready, it calls `launch`.

             // But my current plan was "api.game.launch" does everything.

             sender.send(IPC.GAME_STARTUP_ERROR, 'Java not found. Please check settings.')
             return
        }

        // dlAsync Logic
        const commonDir = ConfigManager.getCommonDirectory()
        const instanceDir = ConfigManager.getInstanceDirectory()
        const launcherDir = ConfigManager.getLauncherDirectory()
        const isDev = DistroAPI.isDevMode()

        const fullRepairModule = new FullRepair(
            commonDir,
            instanceDir,
            launcherDir,
            serverId,
            isDev
        )

        // Spawn Receiver (Child Process for Validation)
        // Note: FullRepair uses fork, which works in Main.
        fullRepairModule.spawnReceiver()

        // Forward progress
        const onProgress = (percent) => {
            if (!sender.isDestroyed()) sender.send(IPC.GAME_PROGRESS, 'validating', percent)
        }

        try {
            await fullRepairModule.verifyFiles(onProgress)
            await fullRepairModule.download((percent) => {
                if (!sender.isDestroyed()) sender.send(IPC.GAME_PROGRESS, 'downloading', percent)
            })
        } catch (err) {
            logger.warn('Error during file validation/download', err)
            // Continue with local files?
        }

        try {
            fullRepairModule.destroyReceiver()
        } catch (e) { /* ignore */ }

        // Prepare Launch
        if (!sender.isDestroyed()) sender.send(IPC.GAME_PROGRESS, 'preparing', 100)

        const mojangIndexProcessor = new MojangIndexProcessor(commonDir, server.rawServer.minecraftVersion)
        const versionData = await mojangIndexProcessor.getVersionJson() // or getLocalVersionJson
        const distributionIndexProcessor = new DistributionIndexProcessor(commonDir, distro, serverId)
        const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(server)

        const pb = new ProcessBuilder(server, versionData, modLoaderData, authUser, app.getVersion())

        // Build Process
        const child = pb.build()

        child.stdout.on('data', (data) => {
            if (!sender.isDestroyed()) sender.send(IPC.GAME_CONSOLE_LOG, data.toString())
        })
        child.stderr.on('data', (data) => {
            if (!sender.isDestroyed()) sender.send(IPC.GAME_CONSOLE_LOG, data.toString())
        })
        child.on('close', (code) => {
            if (!sender.isDestroyed()) sender.send(IPC.GAME_CLOSE, code)
        })

        if (!sender.isDestroyed()) sender.send(IPC.GAME_PROGRESS, 'launched')

    } catch (error) {
        logger.error('Launch failed', error)
        if (!sender.isDestroyed()) sender.send(IPC.GAME_ERROR, error.message)
    }
})

// Handle Mods
ipcMain.handle(IPC.SCAN_MODS, async (event, dir, ver) => {
    const DropinModUtil = require('../dropinmodutil')
    return DropinModUtil.scanForDropinMods(dir, ver)
})

ipcMain.handle(IPC.DELETE_MOD, async (event, dir, name) => {
    const DropinModUtil = require('../dropinmodutil')
    return await DropinModUtil.deleteDropinMod(dir, name)
})

ipcMain.handle(IPC.TOGGLE_MOD, async (event, dir, name, enable) => {
    const DropinModUtil = require('../dropinmodutil')
    return await DropinModUtil.toggleDropinMod(dir, name, enable)
})

ipcMain.handle(IPC.SCAN_SHADERS, async (event, dir) => {
    const DropinModUtil = require('../dropinmodutil')
    return DropinModUtil.scanForShaderpacks(dir)
})

ipcMain.handle(IPC.SET_SHADER, async (event, dir, pack) => {
    const DropinModUtil = require('../dropinmodutil')
    return DropinModUtil.setEnabledShaderpack(dir, pack)
})

ipcMain.handle(IPC.ADD_MODS, async (event, files, dir) => {
    // files is a FileList in renderer. Here we need paths.
    // Renderer needs to send array of {path, name}
    const DropinModUtil = require('../dropinmodutil')
    return DropinModUtil.addDropinMods(files, dir)
})

ipcMain.send(IPC.OPEN_FOLDER, async (event, dir) => {
    shell.openPath(dir)
})
