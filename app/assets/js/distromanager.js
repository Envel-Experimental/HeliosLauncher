const { DistributionAPI } = require('./core/common/DistributionAPI')
const { retry } = require('./util')

const ConfigManager = require('./configmanager')

// Old WesterosCraft url.
// exports.REMOTE_DISTRO_URL = 'http://mc.westeroscraft.com/WesterosCraftLauncher/distribution.json'
exports.REMOTE_DISTRO_URL = 'https://f-launcher.ru/fox/new/distribution.json'

const { DISTRO_PUB_KEYS } = require('../../../network/config')
const Lang = require('./langloader')

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false,
    DISTRO_PUB_KEYS
)

const originalPullRemote = api.pullRemote.bind(api)
api.pullRemote = async () => {
    // console.log('[DistroManager] Intercepting pullRemote...');
    let result;
    try {
        result = await originalPullRemote()
    } catch (err) {
        if (err.dataPackage && err.dataPackage.signatureValid === false) {
            console.log('[DistroManager] Signature INVALID! Triggering overlay.');
            result = err.dataPackage;
            // Fallthrough to overlay logic
        } else {
            throw err;
        }
    }

    // console.log('[DistroManager] Result:', result ? { ...result, data: '...' } : 'null');

    // Ed25519 Signature Verification
    if (result.data != null && result.signatureValid === false) {
        // Construct the prompt
        // Using a Promise to halt execution until user decides
        return new Promise((resolve) => {
            const showSigError = () => {
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', showSigError, { once: true })
                    return
                }
                const btnAck = document.getElementById('overlayAcknowledge')
                const btnAckMid = document.getElementById('overlayAcknowledgeMid')

                // Style: Green "Retry" button (Main)
                const originalColor = btnAck.style.backgroundColor
                btnAck.style.backgroundColor = '#28a745' // Green

                // Style: Red "Proceed" button (Secondary)
                const originalColorMid = btnAckMid.style.backgroundColor
                const originalBorderMid = btnAckMid.style.border
                const originalBoxShadowMid = btnAckMid.style.boxShadow
                btnAckMid.style.backgroundColor = 'transparent' // Transparent
                btnAckMid.style.border = '1px solid #dc3545' // Red Border
                btnAckMid.style.boxShadow = 'none'

                const resetUI = () => {
                    btnAck.style.backgroundColor = originalColor
                    btnAckMid.style.backgroundColor = originalColorMid
                    btnAckMid.style.border = originalBorderMid
                    btnAckMid.style.boxShadow = originalBoxShadowMid
                    toggleOverlay(false)
                }

                setOverlayContent(
                    Lang.queryJS('distro.verification.title'),
                    Lang.queryJS('distro.verification.desc'),
                    Lang.queryJS('distro.verification.retry'),   // Button 1: Retry
                    Lang.queryJS('distro.verification.proceed'), // Button 2: Proceed
                    Lang.queryJS('distro.verification.close')
                )

                // Retry (Safe/Main)
                setOverlayHandler(async () => {
                    resetUI()
                    // Add small delay
                    setTimeout(async () => {
                        try {
                            resolve(await api.pullRemote())
                        } catch (e) {
                            resolve(await api.pullRemote())
                        }
                    }, 500)
                })

                // Continue (Unsafe/Secondary)
                setMiddleButtonHandler(() => {
                    resetUI()
                    resolve(result) // Return the data anyway
                })

                // Close
                setDismissHandler(() => {
                    // Do not reset UI here immediately because window closes, but good check
                    const remote = require('@electron/remote')
                    remote.getCurrentWindow().close()
                })

                toggleOverlay(true, true)
            }
            showSigError()
        })
    }

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
    return await retry(
        realGetDistribution,
        MAX_DOWNLOAD_RETRIES,
        DOWNLOAD_RETRY_DELAY,
        (err) => {
            return err.error === FAILED_DOWNLOAD_ERROR_CODE
        }
    ).catch((err) => {
        // Log the error, but do not throw it.
        // This allows the launcher to continue in offline mode.
        console.error('Failed to download distribution index after multiple retries.', err)
        return null
    })
}

exports.DistroAPI = api
