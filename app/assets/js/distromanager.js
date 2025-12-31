const { DistributionAPI } = require('@envel/helios-core/common')
const { retry } = require('./util')

const ConfigManager = require('./configmanager')

// Old WesterosCraft url.
// exports.REMOTE_DISTRO_URL = 'http://mc.westeroscraft.com/WesterosCraftLauncher/distribution.json'
exports.REMOTE_DISTRO_URL = 'https://f-launcher.ru/fox/new/distribution.json'

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

const originalPullRemote = api.pullRemote.bind(api)
api.pullRemote = async () => {
    const result = await originalPullRemote()
    if (result.data == null) {
        api._remoteFailed = true
    } else {
        api._remoteFailed = false
    }
    return result
}

const FAILED_DOWNLOAD_ERROR_CODE = 1
const MAX_DOWNLOAD_RETRIES = 5
const DOWNLOAD_RETRY_DELAY = 1000

const realGetDistribution = api.getDistribution.bind(api)
api.getDistribution = async () => {
    return await retry(
        realGetDistribution,
        MAX_DOWNLOAD_RETRIES,
        DOWNLOAD_RETRY_DELAY,
        (err) => {
            return err.error === FAILED_DOWNLOAD_ERROR_CODE || err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT'
        }
    ).catch((err) => {
        // Log the error, but do not throw it.
        // This allows the launcher to continue in offline mode.
        console.error('Failed to download distribution index after multiple retries.', err)
        return null
    })
}

exports.DistroAPI = api
