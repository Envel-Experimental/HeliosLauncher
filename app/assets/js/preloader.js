const { ipcRenderer } = require('electron')

// Global error handling for Renderer Process
// We define these as early as possible to catch startup errors
window.onerror = (message, source, lineno, colno, error) => {
    const errorMsg = error ? (error.stack || error.message) : message
    ipcRenderer.send('renderer-error', errorMsg)
}

window.onunhandledrejection = (event) => {
    const errorMsg = event.reason ? (event.reason.stack || event.reason.message || event.reason.toString()) : 'Unhandled Promise Rejection'
    ipcRenderer.send('renderer-error', errorMsg)
}

// Add Node-level error handling for the renderer
process.on('uncaughtException', (error) => {
    const errorMsg = error.stack || error.message || error.toString()
    ipcRenderer.send('renderer-error', errorMsg)
})

const fs = require('fs-extra')
const { app } = require('@electron/remote')
const os = require('os')
const path = require('path')


const NetworkConfig = require('../../../network/config')
const ConfigManager = require('./configmanager')
const { DistroAPI } = require('./distromanager')
const LangLoader = require('./langloader')
const { LoggerUtil } = require('./core/util/LoggerUtil')
const { retry } = require('./util')
let Sentry

const logger = LoggerUtil.getLogger('Preloader')

async function preloader() {
    logger.info('Loading..')

    LangLoader.setupLanguage()

    try {
        if (process.env.NODE_ENV !== 'development') {
            Sentry = require('@sentry/electron/renderer')
            let releaseVersion = 'unknown'
            try {
                releaseVersion = app.getVersion()
            } catch (e) {
                // app might not be ready yet in early preload
                try {
                    releaseVersion = require('../../../package.json').version
                } catch (e2) {
                    // ignore
                }
            }

            Sentry.init({
                dsn: 'https://f02442d2a0733ac2c810b8d8d7f4a21e@o4508545424359424.ingest.de.sentry.io/4508545432027216',
                release: 'FLauncher@' + releaseVersion,
                ignoreErrors: ['EACCES', 'EPERM']
            })

            const systemInfo = {
                platform: os.platform(),
                arch: os.arch(),
                cpu: os.cpus(),
                totalMemory: os.totalmem(),
                freeMemory: os.freemem(),
                hostname: os.hostname(),
            }

            Sentry.setContext('system', systemInfo)
        } else {
            logger.info('Sentry disabled in development mode.')
        }
    } catch (error) {
        logger.warn('Sentry initialization failed:', error)
    }

    try {
        await ConfigManager.load()
    } catch (err) {
        logger.error('Error loading config:', err)
        ipcRenderer.send('distributionIndexDone', false)
        return
    }

    // P2P Kill Switch Check (Async/Parallel)
    checkP2PKillSwitch()

    DistroAPI['commonDir'] = ConfigManager.getCommonDirectory()
    DistroAPI['instanceDir'] = ConfigManager.getInstanceDirectory()

    LangLoader.setupLanguage()

    try {
        const heliosDistro = await DistroAPI.getDistribution()
        logger.info('Loaded distribution index.')

        if (heliosDistro) {
            if (ConfigManager.getSelectedServer() == null || heliosDistro.getServerById(ConfigManager.getSelectedServer()) == null) {
                logger.info('Determining default selected server..')
                ConfigManager.setSelectedServer(heliosDistro.getMainServer().rawServer.id)
                await ConfigManager.save()
            }
            ipcRenderer.send('distributionIndexDone', true)
        } else {
            logger.error('Loaded distribution index is null.')
            ipcRenderer.send('distributionIndexDone', false)
        }

    } catch (err) {
        logger.error('Failed to load distribution index, continuing in offline mode.', err)
        sendToSentry(`Failed to load distribution index: ${err.message}`, 'error')
        ipcRenderer.send('distributionIndexDone', false)
    }

    try {
        await retry(() => fs.remove(path.join(os.tmpdir(), ConfigManager.getTempNativeFolder())))
        logger.info('Cleaned natives directory.')
    } catch (err) {
        if (err.code === 'EACCES') {
            logger.warn('Could not clean natives directory, permission denied.')
        } else {
            logger.warn('Error while cleaning natives directory:', err)
            sendToSentry(`Error cleaning natives directory: ${err.message}`, 'error')
        }
    }
}

// Capture log or error and send to Sentry
function sendToSentry(message, type = 'info') {
    if (Sentry) {
        if (type === 'error') {
            Sentry.captureException(new Error(message))
        } else {
            Sentry.captureMessage(message)
        }
    }
}

async function checkP2PKillSwitch() {
    try {
        const response = await fetch(NetworkConfig.P2P_KILL_SWITCH_URL, { cache: 'no-store' })
        if (response.ok) {
            logger.info('P2P Kill Switch activated by remote configuration.')
            ConfigManager.setLocalOptimization(false)
            ConfigManager.setGlobalOptimization(false)
            ConfigManager.setP2PUploadEnabled(false)
            ConfigManager.setP2POnlyMode(false)
            await ConfigManager.save()
        }
    } catch (err) {
        // Optional feature, failure is expected if kill switch is not active.
    }
}

module.exports = { sendToSentry }

// Initialize Language Loader immediately to prevent race conditions
LangLoader.setupLanguage()

preloader()