const { shell } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { LoggerUtil } = require('../util/LoggerUtil')
const { Type } = require('../common/DistributionClasses')
const { sendToSentry } = require('../../preloader')

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
                if (crashAnalysis.type === 'java-oom') {
                    this.enrichOOMAnalysis(crashAnalysis)
                }
                this.showSpecificCrashOverlay(crashAnalysis)
            } else {
                await this.showGenericCrashOverlay(code)
            }
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
                // Check if directory exists
                const crashReportsExist = await fs.promises.stat(crashReportsDir).then(() => true).catch(() => false)
                if (crashReportsExist) {
                    const files = await fs.promises.readdir(crashReportsDir)
                    const crashFiles = await Promise.all(files
                        .filter(f => f.endsWith('.txt') || f.endsWith('.log'))
                        .map(async f => {
                            const p = path.join(crashReportsDir, f)
                            const s = await fs.promises.stat(p)
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
        if (ConfigManager.getSupportUrl()) {
            setOverlayContent(
                Lang.queryJS('processbuilder.crash.title'),
                Lang.queryJS('processbuilder.crash.body', { description: crashAnalysis.description }),
                Lang.queryJS('processbuilder.crash.fix'),
                'Поддержка', // Button 2
                Lang.queryJS('processbuilder.crash.close') // Button 3 (Dismiss)
            )
            setOverlayHandler(() => this.handleCrashFix(crashAnalysis))
            setMiddleButtonHandler(() => {
                shell.openExternal(ConfigManager.getSupportUrl())
                toggleOverlay(false)
            })
            setDismissHandler(() => toggleOverlay(false))
            toggleOverlay(true, true)
        } else {
            setOverlayContent(
                Lang.queryJS('processbuilder.crash.title'),
                Lang.queryJS('processbuilder.crash.body', { description: crashAnalysis.description }),
                Lang.queryJS('processbuilder.crash.fix'),
                Lang.queryJS('processbuilder.crash.close') // Button 2
            )
            setOverlayHandler(() => this.handleCrashFix(crashAnalysis))
            setMiddleButtonHandler(() => toggleOverlay(false))
            setDismissHandler(null)
            toggleOverlay(true)
        }
    }

    /**
     * Display a generic crash overlay with the exit code and option to disable mods.
     * 
     * @param {number} code Exit code.
     */
    async showGenericCrashOverlay(code) {
        // IMPROVED CRASH REPORTING: Extract "Smart" Signature for Sentry Grouping
        let sentryMessage = `Process exited with code: ${code}`
        let sentryType = 'error'

        if (this.logBuffer && this.logBuffer.length > 0) {
            const fullLog = this.logBuffer.join('\n')

            // Common Java Exception Patterns
            const exceptionMatch = fullLog.match(/Exception in thread "[^"]+" ([\w\.]+)/) ||
                fullLog.match(/(java\.lang\.[\w]+Exception)/) ||
                fullLog.match(/(java\.lang\.[\w]+Error)/) ||
                fullLog.match(/([a-zA-Z0-9_\.]*Exception)/)

            if (exceptionMatch) {
                // Found a specific Java exception (e.g. java.lang.UnsatisfiedLinkError)
                // Use this as the error message so Sentry groups them together
                sentryMessage = `Game Crash: ${exceptionMatch[1]}`
            } else if (fullLog.includes('Out of memory')) {
                sentryMessage = 'Game Crash: Out of Memory'
            } else if (fullLog.includes('EXCEPTION_ACCESS_VIOLATION')) {
                sentryMessage = 'Game Crash: Native Access Violation'
            }

            // Append log tail to the *details* (stack trace / context) not the title/message if possible
            // But since we are using captureException(new Error(msg)), we can append it after a newline
            // Sentry usually groups by the first line or the type.
            const logTail = this.logBuffer.slice(-25).join('\n')
            sentryMessage += `\n\n--- Log Tail ---\n${logTail}`
        }

        sendToSentry(sentryMessage, sentryType)

        // Check for Support URL again (in case preloader failed or config desync)
        let supportUrl = ConfigManager.getSupportUrl()
        if (!supportUrl) {
            try {
                // Determine remote URL from network/config
                const NetworkConfig = require('../../../network/config')
                const response = await fetch(NetworkConfig.SUPPORT_CONFIG_URL, { cache: 'no-store' })
                if (response.ok) {
                    const data = await response.json()
                    if (data.url) {
                        supportUrl = data.url
                        ConfigManager.setSupportUrl(supportUrl)
                        ConfigManager.save()
                    }
                }
            } catch (err) {
                logger.warn('Failed to fetch support URL during crash handling', err)
            }
        }

        if (supportUrl) {
            setOverlayContent(
                Lang.queryJS('processbuilder.exit.crash.title'),
                Lang.queryJS('processbuilder.exit.crash.body', { exitCode: code }),
                'Поддержка', // Button 1
                Lang.queryJS('processbuilder.exit.crash.disable'), // Button 2
                Lang.queryJS('processbuilder.exit.crash.close') // Button 3
            )
            setOverlayHandler(() => {
                shell.openExternal(supportUrl)
                toggleOverlay(false)
            })
            setMiddleButtonHandler(() => this.disableOptionalMods())
            setDismissHandler(() => toggleOverlay(false))
            toggleOverlay(true, true)
        } else {
            setOverlayContent(
                Lang.queryJS('processbuilder.exit.crash.title'),
                Lang.queryJS('processbuilder.exit.crash.body', { exitCode: code }),
                Lang.queryJS('processbuilder.exit.crash.close'), // Button 1
                Lang.queryJS('processbuilder.exit.crash.disable') // Button 2
            )
            setOverlayHandler(() => toggleOverlay(false))
            setMiddleButtonHandler(() => this.disableOptionalMods())
            setDismissHandler(null)
            toggleOverlay(true)
        }
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
                fs.rmSync(versionPath, { recursive: true, force: true })
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



        } else if (crashAnalysis.type === 'java-corruption') {
            this.handleJavaRepair()
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
     * Attempts to repair a corrupted Java installation by deleting it and resetting config.
     */
    handleJavaRepair() {
        const serverId = this.server.rawServer.id
        const javaPath = ConfigManager.getJavaExecutable(serverId)

        if (!javaPath) {
            logger.warn('Cannot repair Java: No Java executable configured.')
            this.restartGame()
            return
        }

        const dataDir = ConfigManager.getDataDirectory()
        // Simple check: is the java path inside the data directory?
        const isManaged = javaPath.startsWith(dataDir)

        if (isManaged) {
            logger.info(`Detected corrupted managed Java at ${javaPath}. Attempting removal...`)

            try {
                const runtimeDir = path.join(dataDir, 'runtime')
                // If the path is definitely inside runtime
                if (javaPath.startsWith(runtimeDir)) {
                    // Standard structure: <dataDir>/runtime/<arch>/<folder>/bin/java...
                    const relative = path.relative(runtimeDir, javaPath)
                    const parts = relative.split(path.sep)

                    // parts[0] = arch, parts[1] = java-folder
                    if (parts.length >= 2) {
                        const dirToDelete = path.join(runtimeDir, parts[0], parts[1])
                        logger.info(`Removing Java directory: ${dirToDelete}`)
                        if (fs.existsSync(dirToDelete)) {
                            fs.rmSync(dirToDelete, { recursive: true, force: true })
                        }
                    }
                }
            } catch (e) {
                logger.error('Failed to repair Java', e)
            }
        } else {
            logger.warn('Java is not managed by launcher (custom path). Resetting config to force re-selection.')
        }

        // Reset config to force re-download or re-selection
        ConfigManager.setJavaExecutable(serverId, null)
        ConfigManager.save()
        logger.info('Java configuration reset. Restarting...')

        this.restartGame()
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

    /**
     * Enriches the OOM crash analysis with specific advice based on system memory.
     * @param {Object} analysis The crash analysis object.
     */
    enrichOOMAnalysis(analysis) {
        const totalMem = os.totalmem() / (1024 * 1024 * 1024) // GB
        const freeMem = os.freemem() / (1024 * 1024 * 1024) // GB

        let advice = ""
        if (totalMem < 6) {
            advice = "У вас мало физической памяти (RAM). Попробуйте закрыть все лишние программы перед запуском."
        } else if (freeMem < 2.5) {
            advice = "Свободной памяти мало. Закройте другие программы."
        } else {
            advice = "Свободной памяти достаточно. Попробуйте выделить больше памяти игре в настройках лаунчера (Настройки -> Java)."
        }

        analysis.description = `Игра вылетела из-за нехватки памяти.\n\n${advice}\n\n(Свободно: ${freeMem.toFixed(1)} GB, Всего: ${totalMem.toFixed(1)} GB)`
    }
}

module.exports = GameCrashHandler
