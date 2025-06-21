/* global setOverlayContent, Lang, toggleOverlay, setOverlayHandler, setDismissHandler */
const { sendToSentry } = require('../../preloader') // Relative path
const logger = require('./logging') // Use the centralized logger

/**
 * Handles the scenario when the Minecraft process exits with an error.
 * Reports to Sentry and displays an overlay message to the user.
 *
 * @param {number} code The exit code of the process.
 * @param {string | null} signal The signal with which the process was terminated, if any.
 */
function handleProcessExitError(code, signal) {
    const errorMessage = `Minecraft process exited with code: ${code}${signal ? ` (signal: ${signal})` : ''}`

    sendToSentry(errorMessage, 'error')
    logger.error(errorMessage)

    // Assuming global UI functions are available as in the original ProcessBuilder
    // If these are not global, they'd need to be passed or handled differently.
    if (typeof setOverlayContent === 'function' && typeof Lang !== 'undefined') {
        setOverlayContent(
            Lang.queryJS('processbuilder.exit.exitErrorHeader'),
            Lang.queryJS('processbuilder.exit.message') + code,
            Lang.queryJS('uibinder.startup.closeButton')
        )
        setOverlayHandler(() => {
            toggleOverlay(false)
        })
        setDismissHandler(() => {
            toggleOverlay(false)
        })
        toggleOverlay(true, true)
    } else {
        logger.warn('UI functions for error overlay not available during process exit error handling.')
    }
}

module.exports = {
    handleProcessExitError,
}
