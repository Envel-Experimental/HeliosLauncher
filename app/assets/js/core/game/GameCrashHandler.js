const { shell } = require('electron')
const fs = require('fs-extra')
const path = require('path')
const { LoggerUtil } = require('../util/LoggerUtil')
const { Type } = require('../common/DistributionClasses')
const { sendToSentry } = require('../../preloader')
const { retry } = require('../../util')
const CrashHandler = require('../../crash-handler')
const DropinModUtil = require('../../dropinmodutil')
const ConfigManager = require('../../configmanager')
const Lang = require('../../langloader')

const logger = LoggerUtil.getLogger('GameCrashHandler')

/* global setOverlayContent, setOverlayHandler, setDismissHandler, toggleOverlay, setMiddleButtonHandler */

/**
 * Module responsible for handling game crashes and exit events.
 * 
 * Responsibilities:
 * 1. Listening for process exit codes.
 * 2. Analyzing logs and crash reports to determine the cause.
 * 3. Displaying appropriate UI overlays (Driver issues, OOM, General Crash).
 * 4. Executing fix actions (e.g., deleting corrupted files, opening external help links).
 */
class GameCrashHandler {

    /**
     * @param {string} gameDir Absolute path to the game directory.
     * @param {string} commonDir Absolute path to the common directory.
     * @param {Object} server The server distribution object.
     * @param {Array.<string>} logBuffer Buffer of the last 1000 console lines from the process.
     */
    constructor(gameDir, commonDir, server, logBuffer) {
        this.gameDir = gameDir
        this.commonDir = commonDir
        this.server = server
        this.logBuffer = logBuffer
    }

    /**
     * Main entry point when the game process exits.
     * 
     * @param {number} code The exit code of the process.
     */
    async handleExit(code) {
        logger.info('Exited with code', code)

        // Codes 0 (Success), 130 (SIGINT), 137 (SIGKILL), 143 (SIGTERM), 255 (User Force Quit sometimes) are not crashes.
        const isCrash = code !== 0 && code !== 130 && code !== 137 && code !== 143 && code !== 255

        if (isCrash) {
            const crashAnalysis = await this.analyzeCrash()

            if (crashAnalysis) {
                this.showSpecificCrashOverlay(crashAnalysis)
            } else {
                this.showGenericCrashOverlay(code)
            }
            toggleOverlay(true)
        }
    }

    /**
     * Analyze log files, crash reports, and memory buffers to identify the crash reason.
     * 
     * @returns {Object|null} The crash analysis object or null if unknown.
     */
    async analyzeCrash() {
        const logPath = path.join(this.gameDir, 'logs', 'latest.log')
        const crashReportsDir = path.join(this.gameDir, 'crash-reports')
        let crashAnalysis = null

        // 1. Try reading from disk (Preferred, contains full context)
        try {
            await new Promise(resolve => setTimeout(resolve, 1500))
            crashAnalysis = await CrashHandler.analyzeFile(logPath)
        } catch (e) {
            logger.warn('Failed to analyze latest.log file', e)
        }

        // 2. Fallback: Check for fresh crash report files
        if (!crashAnalysis) {
            try {
                if (await fs.pathExists(crashReportsDir)) {
                    const files = await fs.readdir(crashReportsDir)
                    const crashFiles = await Promise.all(files
                        .filter(f => f.endsWith('.txt') || f.endsWith('.log'))
                        .map(async f => {
                            const p = path.join(crashReportsDir, f)
                            const s = await fs.stat(p)
                            return { name: f, path: p, time: s.mtime.getTime() }
                        }))
                    crashFiles.sort((a, b) => b.time - a.time)

                    if (crashFiles.length > 0) {
                        const newestCrash = crashFiles[0]
                        // If file was created in the last 2 minutes
                        if (Date.now() - newestCrash.time < 120 * 1000) {
                            logger.info(`Found fresh crash report: ${newestCrash.name}`)
                            crashAnalysis = await CrashHandler.analyzeFile(newestCrash.path)
                        }
                    }
                }
            } catch (e) {
                logger.warn('Failed to find/read crash report file', e)
            }
        }

        // 3. Fallback: Check memory buffer if disk failed
        if (!crashAnalysis) {
            logger.info('Disk log analysis failed. Analyzing memory buffer...')
            const memoryLog = this.logBuffer ? this.logBuffer.join('\n') : ''
            crashAnalysis = CrashHandler.analyzeLog(memoryLog)
        }

        return crashAnalysis
    }

    /**
     * Display a specific overlay based on the analyzed crash type.
     * 
     * @param {Object} crashAnalysis The analysis result from CrashHandler using logs.
     */
    showSpecificCrashOverlay(crashAnalysis) {
        setOverlayContent(
            Lang.queryJS('processbuilder.crash.title'),
            Lang.queryJS('processbuilder.crash.body', { description: crashAnalysis.description }),
            Lang.queryJS('processbuilder.crash.fix'),
            Lang.queryJS('processbuilder.crash.close')
        )

        // Default handlers
        setOverlayHandler(() => this.handleCrashFix(crashAnalysis))
        setMiddleButtonHandler(() => toggleOverlay(false))
        setDismissHandler(() => toggleOverlay(false))

        // Specific Overrides for Drivers / OOM
        if (crashAnalysis.type === 'gpu-driver-outdated') {
            setOverlayContent(
                Lang.queryJS('processbuilder.crash.driversTitle'),
                Lang.queryJS('processbuilder.crash.body', { description: crashAnalysis.description }),
                Lang.queryJS('processbuilder.crash.driversUpdate'), // Button 1
                Lang.queryJS('processbuilder.crash.close')         // Button 2 (Dismiss)
            )
            setOverlayHandler(() => {
                shell.openExternal('https://www.nvidia.com/Download/index.aspx')
                toggleOverlay(false)
            })
            setMiddleButtonHandler(() => toggleOverlay(false))

        } else if (crashAnalysis.type === 'gpu-oom') {
            setOverlayContent(
                Lang.queryJS('processbuilder.crash.oomTitle'),
                Lang.queryJS('processbuilder.crash.body', { description: crashAnalysis.description }),
                Lang.queryJS('processbuilder.crash.close'),
                null
            )
            setOverlayHandler(() => toggleOverlay(false))
            setMiddleButtonHandler(null)

        } else if (crashAnalysis.type === 'gpu-gl-on-12') {
            setOverlayContent(
                Lang.queryJS('processbuilder.crash.glErrorTitle'),
                Lang.queryJS('processbuilder.crash.body', { description: crashAnalysis.description }),
                Lang.queryJS('processbuilder.crash.driversUpdate'),
                Lang.queryJS('processbuilder.crash.close')
            )
            setOverlayHandler(() => {
                shell.openExternal('https://www.intel.com/content/www/us/en/support/detect.html')
                toggleOverlay(false)
            })
            setMiddleButtonHandler(() => toggleOverlay(false))
        }
    }

    /**
     * Display a generic crash overlay with the exit code and option to disable mods.
     * 
     * @param {number} code Exit code.
     */
    showGenericCrashOverlay(code) {
        const exitMessage = `Process exited with code: ${code}`
        sendToSentry(exitMessage, 'error')

        setOverlayContent(
            Lang.queryJS('processbuilder.exit.crash.title'),
            Lang.queryJS('processbuilder.exit.crash.body', { exitCode: code }),
            Lang.queryJS('processbuilder.exit.crash.close'),
            Lang.queryJS('processbuilder.exit.crash.disable')
        )

        setOverlayHandler(() => toggleOverlay(false))
        setMiddleButtonHandler(() => this.disableOptionalMods())
        setDismissHandler(() => toggleOverlay(false))
    }

    /**
     * Execute the fix for a known crash type.
     * 
     * @param {Object} crashAnalysis The crash analysis.
     */
    handleCrashFix(crashAnalysis) {
        if (crashAnalysis.type === 'missing-version-file') {
            const versionPath = path.join(this.commonDir, 'versions', path.basename(crashAnalysis.file, '.json'))
            if (fs.existsSync(versionPath)) {
                fs.removeSync(versionPath)
            }
            toggleOverlay(false)

        } else if (crashAnalysis.type === 'incompatible-mods') {
            const modsDir = path.join(this.gameDir, 'mods')
            try {
                const dropinMods = DropinModUtil.scanForDropinMods(modsDir, this.server.rawServer.minecraftVersion)
                for (const mod of dropinMods) {
                    fs.unlinkSync(path.join(modsDir, mod.fullName))
                }
            } catch (e) {
                logger.warn('Failed to delete drop-in mods', e)
            }

            // Reset config
            let modCfg = ConfigManager.getModConfiguration(this.server.rawServer.id)
            if (modCfg) {
                modCfg.mods = {}
                ConfigManager.setModConfiguration(this.server.rawServer.id, modCfg)
                ConfigManager.save()
            }

            this.restartGame()

        } else {
            // Config file corruption
            const configPath = path.join(this.gameDir, 'config', crashAnalysis.file)
            if (fs.existsSync(configPath)) {
                const disabledPath = configPath + '.disabled'
                if (fs.existsSync(disabledPath)) fs.unlinkSync(disabledPath)
                fs.renameSync(configPath, disabledPath)
            }
            this.restartGame()
        }
    }

    /**
     * Disable all optional mods and save configuration.
     */
    disableOptionalMods() {
        const modCfg = ConfigManager.getModConfiguration(this.server.rawServer.id)
        for (const mdl of this.server.modules) {
            const type = mdl.rawModule.type
            if (type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod) {
                if (!mdl.getRequired().value) {
                    modCfg.mods[mdl.getVersionlessMavenIdentifier()] = { value: false }
                }
            }
        }
        ConfigManager.setModConfiguration(this.server.rawServer.id, modCfg)
        ConfigManager.save()

        setOverlayContent(
            Lang.queryJS('processbuilder.exit.disabled.title'),
            Lang.queryJS('processbuilder.exit.disabled.body'),
            Lang.queryJS('processbuilder.exit.disabled.close')
        )
        setOverlayHandler(() => toggleOverlay(false))
        setMiddleButtonHandler(null)
    }

    /**
     * Attempt to automatically restart the game.
     */
    restartGame() {
        toggleOverlay(false)
        setTimeout(() => {
            const launchBtn = document.getElementById('launch_button')
            if (launchBtn) launchBtn.click()
        }, 1000)
    }
}

module.exports = GameCrashHandler
