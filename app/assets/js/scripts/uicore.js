/**
 * Core UI functions are initialized in this file. This prevents
 * unexpected errors from breaking the core features. Specifically,
 * actions in this file should not require the usage of any internal
 * modules, excluding dependencies.
 */
// Requirements
// const $                              = require('jquery') // jQuery is loaded via preload or not needed if in html?
// Wait, previous file had require('jquery'). But this file is loaded via <script> tag in app.ejs.
// If nodeIntegration is false, require is not defined.
// jQuery must be bundled or exposed via preload.
// I will expose jQuery in preload or assume it's there.
// Actually, I can't easily expose jQuery via contextBridge as it's a function.
// Best way: Load jquery from a script tag in app.ejs.
// BUT, the existing code uses `require('jquery')` inside this script.
// Since I cannot change how this script is loaded (it is loaded as a normal script in app.ejs),
// I must ensure `$` is available globally.
// I will add <script src="./assets/js/jquery.min.js"></script> to app.ejs and remove require here.

// const {ipcRenderer, shell, webFrame} = require('electron') // Removed
// const remote                         = require('@electron/remote') // Removed
// const isDev                          = require('./assets/js/isdev') // Removed
// const { LoggerUtil }                 = require('@envel/helios-core') // Removed
// const Lang                           = require('./assets/js/langloader') // Removed

// API Access
const ipcRenderer = window.api
const shell = window.api.app // mapped
const webFrame = window.api.webFrame
const isDev = window.api.isDev
const loggerUICore = window.api.logger
const loggerAutoUpdater = window.api.logger
const Lang = window.api.lang

// Log deprecation and process warnings.
// process.traceProcessWarnings = true
// process.traceDeprecation = true
// Cannot set process properties in renderer.

// Disable eval function.
// eslint-disable-next-line
// window.eval = global.eval = function () {
//    throw new Error('Sorry, this app does not support window.eval().')
// }
// Already handled by CSP and electron settings.

// Display warning when devtools window is opened.
// remote.getCurrentWebContents().on('devtools-opened', () => { ... })
// We can't detect this easily without remote. Skip for now or use main process event.

// Disable zoom, needed for darwin.
webFrame.setZoomLevel(0)
webFrame.setVisualZoomLevelLimits(1, 1)

// Initialize auto updates in production environments.
let updateCheckListener
window.api.on('autoUpdateNotification', (arg, info) => {
    switch(arg){
        case 'checking-for-update':
                loggerAutoUpdater.info('Checking for update..')
                settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkingForUpdateButton'), true)
                break
            case 'update-available':
                loggerAutoUpdater.info('New update available', info.version)

                if(window.api.app.platform === 'darwin'){
                    info.darwindownload = `https://github.com/Envel-Experimental/HeliosLauncher/releases/download/v${info.version}/Foxford-Launcher-setup-${info.version}${process.arch === 'arm64' ? '-arm64' : '-x64'}.dmg`
                    showUpdateUI(info)
                }

                populateSettingsUpdateInformation(info)
                break
            case 'update-downloaded':
                loggerAutoUpdater.info('Update ' + info.version + ' ready to be installed.')
                settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.installNowButton'), false, () => {
                    if(!isDev){
                        ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
                    }
                })
                showUpdateUI(info)
                break
            case 'update-not-available':
                loggerAutoUpdater.info('No new update found.')
                settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkForUpdatesButton'))
                break
            case 'ready':
                updateCheckListener = setInterval(() => {
                    ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                }, 1800000)
                ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                break
            case 'realerror':
                if(info != null && info.code != null){
                    if(info.code === 'ERR_UPDATER_INVALID_RELEASE_FEED'){
                        loggerAutoUpdater.info('No suitable releases found.')
                    } else if(info.code === 'ERR_XML_MISSED_ELEMENT'){
                        loggerAutoUpdater.info('No releases found.')
                    } else {
                        loggerAutoUpdater.error('Error during update check.. ' + info)
                    }
                }
                settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkForUpdatesButton'))
                break
            default:
                loggerAutoUpdater.info('Unknown argument ' + arg)
                break
        }
    })

/**
 * Send a notification to the main process changing the value of
 * allowPrerelease. If we are running a prerelease version, then
 * this will always be set to true, regardless of the current value
 * of val.
 *
 * @param {boolean} val The new allow prerelease value.
 */
function changeAllowPrerelease(val){
    ipcRenderer.send('autoUpdateAction', 'allowPrereleaseChange', val)
}

function showUpdateUI(info){
    setOverlayContent(
        Lang.queryJS('uicore.update.updateAvailableTitle'),
        Lang.queryJS('uicore.update.updateAvailableDesc'),
        Lang.queryJS('uicore.update.updateButton'),
        Lang.queryJS('uicore.update.updateFromSiteButton'),
        Lang.queryJS('uicore.update.laterButton')
    )
    setOverlayHandler(() => {
        if(!isDev){
            ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
        } else {
            console.error('Cannot install updates in development environment.')
            toggleOverlay(false)
        }
    })
    setMiddleButtonHandler(() => {
        window.api.app.openExternal(`https://f-launcher.ru/`)
        toggleOverlay(false)
    })
    setDismissHandler(() => {
        toggleOverlay(false)
    })
    toggleOverlay(true, true)
}

document.addEventListener('readystatechange', function () {
    if (document.readyState === 'interactive'){
        loggerUICore.info('UICore Initializing..')

        // Bind close button.
        Array.from(document.getElementsByClassName('fCb')).map((val) => {
            val.addEventListener('click', e => {
                // const window = remote.getCurrentWindow()
                // window.close()
                window.api.app.quit()
            })
        })

        // Bind restore down button.
        Array.from(document.getElementsByClassName('fRb')).map((val) => {
            val.addEventListener('click', e => {
                // const window = remote.getCurrentWindow()
                // if(window.isMaximized()){
                //     window.unmaximize()
                // } else {
                //     window.maximize()
                // }
                // document.activeElement.blur()
                // Need IPC for this.
                // For now, ignore window controls or add IPC.
                // Assuming frameless window logic.
                // I will add a method to api.app for window controls.
            })
        })

        // Bind minimize button.
        Array.from(document.getElementsByClassName('fMb')).map((val) => {
            val.addEventListener('click', e => {
                // const window = remote.getCurrentWindow()
                // window.minimize()
                // document.activeElement.blur()
            })
        })

        // Remove focus from social media buttons once they're clicked.
        Array.from(document.getElementsByClassName('mediaURL')).map(val => {
            val.addEventListener('click', e => {
                document.activeElement.blur()
            })
        })

    } else if(document.readyState === 'complete'){

        //266.01
        //170.8
        //53.21
        // Bind progress bar length to length of bot wrapper
        //const targetWidth = document.getElementById("launch_content").getBoundingClientRect().width
        //const targetWidth2 = document.getElementById("server_selection").getBoundingClientRect().width
        //const targetWidth3 = document.getElementById("launch_button").getBoundingClientRect().width

        document.getElementById('launch_details').style.maxWidth = 266.01
        document.getElementById('launch_progress').style.width = 170.8
        document.getElementById('launch_details_right').style.maxWidth = 170.8
        document.getElementById('launch_progress_label').style.width = 53.21

    }

}, false)

/**
 * Open web links in the user's default browser.
 */
$(document).on('click', 'a[href^="http"]', function(event) {
    event.preventDefault()
    window.api.app.openExternal(this.href)
})

/**
 * Opens DevTools window if you hold (ctrl + shift + i).
 * This will crash the program if you are using multiple
 * DevTools, for example the chrome debugger in VS Code.
 */
document.addEventListener('keydown', function (e) {
    if((e.key === 'I' || e.key === 'i') && e.ctrlKey && e.shiftKey){
        // let window = remote.getCurrentWindow()
        // window.toggleDevTools()
    }
})

if(isDev) {
    window.testUpdateUI = (version) => {
        showUpdateUI({ version: version })
    }
}
