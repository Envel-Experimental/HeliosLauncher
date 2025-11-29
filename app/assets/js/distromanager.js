const { DistributionAPI } = require('@envel/helios-core/common')
const { retry } = require('./util')
const ConfigManager = require('./configmanager')
const { MirrorManager, ConfigUpdater } = require('./mirrormanager')
const { LoggerUtil } = require('@envel/helios-core')

const logger = LoggerUtil.getLogger('DistroManager')

// Default URL for initial fallback
exports.REMOTE_DISTRO_URL = 'https://f-launcher.ru/fox/new/distribution.json'

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

// Wrapper to ensure mirrors are initialized
let mirrorInitPromise = null
async function ensureMirrorsReady() {
    if (!mirrorInitPromise) {
        mirrorInitPromise = (async () => {
            try {
                await MirrorManager.init()
                const best = await MirrorManager.selectBestMirror()
                if (best) {
                    const newUrl = MirrorManager.getDistributionURL()
                    logger.info(`Setting distribution URL to: ${newUrl}`)
                    if (typeof api.setDistributionURL === 'function') {
                        api.setDistributionURL(newUrl)
                    } else {
                        logger.warn('api.setDistributionURL is missing on DistributionAPI!')
                    }

                    // Trigger background update check
                    ConfigUpdater.checkForUpdate(MirrorManager).catch(err => {
                        logger.warn('Config update check failed:', err)
                    })
                }
            } catch (err) {
                logger.error('Error initializing mirrors:', err)
            }
        })()
    }
    return mirrorInitPromise
}

const originalPullRemote = api.pullRemote.bind(api)
api.pullRemote = async () => {
    await ensureMirrorsReady()

    const result = await originalPullRemote()
    if (result.data == null) {
        api._remoteFailed = true
    } else {
        api._remoteFailed = false
    }
    return result
}

const FAILED_DOWNLOAD_ERROR_CODE = 1
const MAX_DOWNLOAD_RETRIES = 3
const DOWNLOAD_RETRY_DELAY = 2000

const realGetDistribution = api.getDistribution.bind(api)

api.getDistribution = async () => {
    await ensureMirrorsReady()

    // Try up to the number of mirrors available
    const maxAttempts = Math.max(MirrorManager.mirrors.length, 1)

    for (let i = 0; i < maxAttempts; i++) {
        try {
            const currentUrl = MirrorManager.getDistributionURL()
            logger.info(`Downloading distribution from ${currentUrl} (Attempt ${i + 1})`)

            const result = await retry(
                realGetDistribution,
                MAX_DOWNLOAD_RETRIES,
                DOWNLOAD_RETRY_DELAY,
                (err) => err.error === FAILED_DOWNLOAD_ERROR_CODE
            )

            if (result) return result

        } catch (err) {
            logger.warn(`Mirror failed: ${MirrorManager.getDistributionURL()}`, err)
        }

        // If failed and we have more attempts, switch to next mirror
        if (i < maxAttempts - 1) {
            const next = MirrorManager.getNextMirror()
            if (next) {
                const newUrl = MirrorManager.getDistributionURL()
                logger.info(`Switching to next mirror: ${newUrl}`)
                if (typeof api.setDistributionURL === 'function') {
                    api.setDistributionURL(newUrl)
                }
            }
        }
    }

    logger.error('Failed to download distribution index from all mirrors.')
    return null
}

exports.DistroAPI = api
