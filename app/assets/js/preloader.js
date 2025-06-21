const { ipcRenderer } = require('electron')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')

const ConfigManager = require('./configmanager')
const { DistroAPI } = require('./distromanager')
const LangLoader = require('./langloader')
const { LoggerUtil } = require('helios-core')
const { HeliosDistribution } = require('helios-core/common')
let Sentry

const logger = LoggerUtil.getLogger('Preloader')

logger.info('Loading..')

try {
    Sentry = require('@sentry/electron/renderer')
    Sentry.init({
        dsn: 'https://f02442d2a0733ac2c810b8d8d7f4a21e@o4508545424359424.ingest.de.sentry.io/4508545432027216',
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
} catch (error) {
    logger.warn('Sentry initialization failed:', error)
}

async function initPreloader() {
    try {
        await ConfigManager.load()
        logger.info('ConfigManager loaded.')

        DistroAPI['commonDir'] = ConfigManager.getCommonDirectory()
        DistroAPI['instanceDir'] = ConfigManager.getInstanceDirectory()
        logger.info('DistroAPI paths configured.')

        LangLoader.setupLanguage()
        logger.info('Language setup complete.')

        const heliosDistro = await DistroAPI.getDistribution()
        logger.info('Loaded distribution index.')
        onDistroLoad(heliosDistro)

    } catch (err) {
        logger.error('Error during preloader initialization:', err)
        sendToSentry(`Error during preloader initialization: ${err.message || err}`, 'error')
        onDistroLoad(null) // Signal that loading failed
    }
}

function onDistroLoad(data) {
    if (data) {
    // Ensure ConfigManager is loaded before using getSelectedServer or save.
    // This is now guaranteed if onDistroLoad is called after successful initPreloader.
        if (ConfigManager.getSelectedServer() == null || data.getServerById(ConfigManager.getSelectedServer()) == null) {
            logger.info('Determining default selected server..')
            ConfigManager.setSelectedServer(data.getMainServer().rawServer.id)
            ConfigManager.save().catch(err => logger.error('Failed to save default server selection:', err)) // Handle async save
        }
    }
    ipcRenderer.send('distributionIndexDone', data !== null)
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

module.exports = { sendToSentry }

// Start the initialization
initPreloader().then(() => {
    logger.info('Preloader initialization sequence finished successfully.')
}).catch(err => {
    // This catch is for unhandled errors from initPreloader itself, though it should catch internally.
    logger.error('Critical unhandled error from preloader init sequence:', err)
    sendToSentry(`Critical unhandled error from preloader init sequence: ${err.message || err}`, 'error')
    onDistroLoad(null) // Ensure UI knows something went wrong
})

// This can run independently as getTempNativeFolder() does not rely on loaded config.
fs.remove(path.join(os.tmpdir(), ConfigManager.getTempNativeFolder()), (err) => {
    if (err) {
        logger.warn('Error while cleaning natives directory:', err)
        sendToSentry(`Error cleaning natives directory: ${err.message}`, 'error')
    } else {
        logger.info('Cleaned natives directory.')
    }
})