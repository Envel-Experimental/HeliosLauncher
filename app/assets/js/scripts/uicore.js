/**
 * Core UI functions are initialized in this file. This prevents
 * unexpected errors from breaking the core features. Specifically,
 * actions in this file should not require the usage of any internal
 * modules, excluding dependencies.
 */
// Requirements
const $ = require('jquery')
const { ipcRenderer, shell, webFrame } = require('electron')
const remote = require('@electron/remote')
const isDev = require('./assets/js/isdev')
const { LoggerUtil } = require('./assets/js/core/util/LoggerUtil')
const Lang = require('./assets/js/langloader')

const loggerUICore = LoggerUtil.getLogger('UICore')
const loggerAutoUpdater = LoggerUtil.getLogger('AutoUpdater')

// Log deprecation and process warnings.
process.traceProcessWarnings = true
process.traceDeprecation = true

// Disable eval function.
// eslint-disable-next-line
window.eval = global.eval = function () {
    throw new Error('Sorry, this app does not support window.eval().')
}

// Display warning when devtools window is opened.
remote.getCurrentWebContents().on('devtools-opened', () => {
    console.log('%c Здесь не рекомендуется ничего вводить, так как это может привести к последствиям, за которые мы не несем ответственность.', 'color: white; -webkit-text-stroke: 1px #a02d2a; font-size: 18px; font-weight: bold')
})

// Disable zoom, needed for darwin.
webFrame.setZoomLevel(0)
webFrame.setVisualZoomLevelLimits(1, 1)

// Initialize auto updates in production environments.
let updateCheckListener
ipcRenderer.on('autoUpdateNotification', (event, arg, info) => {
    switch (arg) {
        case 'checking-for-update':
            loggerAutoUpdater.info('Checking for update..')
            settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkingForUpdateButton'), true)
            break
        case 'update-available':
            loggerAutoUpdater.info('New update available', info.version)

            if (process.platform === 'darwin') {
                info.darwindownload = `https://github.com/Envel-Experimental/HeliosLauncher/releases/download/v${info.version}/Foxford-Launcher-setup-${info.version}${process.arch === 'arm64' ? '-arm64' : '-x64'}.dmg`
                showUpdateUI(info)
            }

            populateSettingsUpdateInformation(info)
            break
        case 'update-downloaded':
            loggerAutoUpdater.info('Update ' + info.version + ' ready to be installed.')
            settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.installNowButton'), false, () => {
                if (!isDev) {
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
            if (info != null && info.code != null) {
                if (info.code === 'ERR_UPDATER_INVALID_RELEASE_FEED') {
                    loggerAutoUpdater.info('No suitable releases found.')
                } else if (info.code === 'ERR_XML_MISSED_ELEMENT') {
                    loggerAutoUpdater.info('No releases found.')
                } else {
                    loggerAutoUpdater.error('Error during update check..', info)
                    loggerAutoUpdater.debug('Error Code:', info.code)
                }
            }
            settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkForUpdatesButton'))
            break
        default:
            loggerAutoUpdater.info('Unknown argument', arg)
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
function changeAllowPrerelease(val) {
    ipcRenderer.send('autoUpdateAction', 'allowPrereleaseChange', val)
}

function showUpdateUI(info) {
    setOverlayContent(
        Lang.queryJS('uicore.update.updateAvailableTitle'),
        Lang.queryJS('uicore.update.updateAvailableDesc'),
        Lang.queryJS('uicore.update.updateButton'),
        Lang.queryJS('uicore.update.updateFromSiteButton'),
        Lang.queryJS('uicore.update.laterButton')
    )
    setOverlayHandler(() => {
        if (!isDev) {
            ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
        } else {
            console.error('Cannot install updates in development environment.')
            toggleOverlay(false)
        }
    })
    setMiddleButtonHandler(() => {
        shell.openExternal(`https://f-launcher.ru/`)
        toggleOverlay(false)
    })
    setDismissHandler(() => {
        toggleOverlay(false)
    })
    toggleOverlay(true, true)
}

/* jQuery Example
$(function(){
    loggerUICore.info('UICore Initialized');
})*/

document.addEventListener('readystatechange', function () {
    if (document.readyState === 'interactive') {
        loggerUICore.info('UICore Initializing..')

        // Bind close button.
        Array.from(document.getElementsByClassName('fCb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.close()
            })
        })

        // Bind restore down button.
        Array.from(document.getElementsByClassName('fRb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                if (window.isMaximized()) {
                    window.unmaximize()
                } else {
                    window.maximize()
                }
                document.activeElement.blur()
            })
        })

        // Bind minimize button.
        Array.from(document.getElementsByClassName('fMb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.minimize()
                document.activeElement.blur()
            })
        })

        // Remove focus from social media buttons once they're clicked.
        Array.from(document.getElementsByClassName('mediaURL')).map(val => {
            val.addEventListener('click', e => {
                document.activeElement.blur()
            })
        })

    } else if (document.readyState === 'complete') {

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
$(document).on('click', 'a[href^="http"]', function (event) {
    event.preventDefault()
    shell.openExternal(this.href)
})

/**
 * Opens DevTools window if you hold (ctrl + shift + i).
 * This will crash the program if you are using multiple
 * DevTools, for example the chrome debugger in VS Code.
 */
document.addEventListener('keydown', function (e) {
    if ((e.key === 'I' || e.key === 'i') && e.ctrlKey && e.shiftKey) {
        let window = remote.getCurrentWindow()
        window.toggleDevTools()
    }
})

if (isDev) {
    window.testUpdateUI = (version) => {
        showUpdateUI({ version: version })
    }
}

// =========================================================================================
// SERVER LIST & ACCOUNT LIST POPULATION (MOVED TO END OR RESTORED)
// =========================================================================================

async function populateServerListings() {
    const distro = await DistroAPI.getDistribution()
    const giaSel = ConfigManager.getSelectedServer()
    const servers = distro.servers
    let htmlString = ''
    for (const serv of servers) {
        // SECURITY: Sanitize Inputs to prevent XSS
        const safeName = serv.rawServer.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;")
        const safeDesc = serv.rawServer.description.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;")
        const safeVer = serv.rawServer.minecraftVersion.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;")
        const safeRev = serv.rawServer.version.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;")

        htmlString += `<button class="serverListing" servid="${serv.rawServer.id}" ${serv.rawServer.id === giaSel ? 'selected' : ''}>
            <img class="serverListingImg" src="${serv.rawServer.icon}"/>
            <div class="serverListingDetails">
                <span class="serverListingName">${safeName}</span>
                <span class="serverListingDescription">${safeDesc}</span>
                <div class="serverListingInfo">
                    <div class="serverListingVersion">${safeVer}</div>
                    <div class="serverListingRevision">${safeRev}</div>
                    ${serv.rawServer.mainServer ? `<div class="serverListingStarWrapper">
                        <svg id="Layer_1" viewBox="0 0 107.45 104.74" width="20px" height="20px">
                            <defs>
                                <style>.cls-1{fill:#fff;}.cls-2{fill:none;stroke:#fff;stroke-miterlimit:10;}</style>
                            </defs>
                            <path class="cls-1" d="M100.93,65.54C89,62,68.18,55.65,63.54,52.13c2.7-5.23,18.8-19.2,28-27.55C81.36,31.74,63.74,43.87,58.09,45.3c-2.41-5.37-3.61-26.52-4.37-39-.77,12.46-2,33.64-4.36,39-5.7-1.46-23.3-13.57-33.49-20.72,9.26,8.37,25.39,22.36,28,27.55C39.21,55.68,18.47,62,6.52,65.55c12.32-2,33.63-6.06,39.34-4.9-.16,5.87-8.41,26.16-13.11,37.69,6.1-10.89,16.52-30.16,21-33.9,4.5,3.79,14.93,23.09,21,34C70,86.84,61.73,66.48,61.59,60.65,67.36,59.49,88.64,63.52,100.93,65.54Z"/>
                            <circle class="cls-2" cx="53.73" cy="53.9" r="38"/>
                        </svg>
                        <span class="serverListingStarTooltip">${Lang.queryJS('settings.serverListing.mainServer')}</span>
                    </div>` : ''}
                </div>
            </div>
        </button>`
    }
    document.getElementById('serverSelectListScrollable').innerHTML = htmlString

}

function populateAccountListings() {
    const accountsObj = ConfigManager.getAuthAccounts()
    const accounts = Array.from(Object.keys(accountsObj), v => accountsObj[v])
    let htmlString = ''
    for (let i = 0; i < accounts.length; i++) {
        // Sanitize display name
        const safeName = accounts[i].displayName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;")

        htmlString += `<button class="accountListing" uuid="${accounts[i].uuid}" ${i === 0 ? 'selected' : ''}>
            <img src="https://mc-heads.net/head/${accounts[i].uuid}/40">
            <div class="accountListingName">${safeName}</div>
        </button>`
    }
    document.getElementById('accountSelectListScrollable').innerHTML = htmlString

}

async function prepareServerSelectionList() {
    await populateServerListings()
    setServerListingHandlers()
}

function prepareAccountSelectionList() {
    populateAccountListings()
    setAccountListingHandlers()
}

// System Warnings
let warningQueue = []

function showNextWarning() {
    if (warningQueue.length > 0) {
        const warningKey = warningQueue.shift()
        const message = Lang.queryJS(`systemChecks.${warningKey}`)
        const title = Lang.queryJS('systemChecks.warningTitle')

        // OOM Mitigation: Add "Light Mode" button for RAM warnings
        if (warningKey === 'lowFreeRAM' || warningKey === 'lowTotalRAM') {
            setOverlayContent(
                title,
                message,
                Lang.queryJS('landing.launch.okay'),
                Lang.queryJS('systemChecks.lightMode') // Middle button text
            )

            setMiddleButtonHandler(async () => {
                const serverId = ConfigManager.getSelectedServer()
                if (serverId) {
                    // Set to safe defaults: 1GB Min, 2GB Max
                    ConfigManager.setMinRAM(serverId, '1024M')
                    ConfigManager.setMaxRAM(serverId, '2048M')
                    await ConfigManager.save()

                    // Show confirmation and proceed to next warning
                    setOverlayContent(
                        title,
                        Lang.queryJS('systemChecks.lightModeEnabled'),
                        Lang.queryJS('landing.launch.okay')
                    )
                    setMiddleButtonHandler(null)
                    setOverlayHandler(showNextWarning)
                    setDismissHandler(showNextWarning)
                } else {
                    showNextWarning()
                }
            })

        } else {
            setOverlayContent(title, message, Lang.queryJS('landing.launch.okay'))
            setMiddleButtonHandler(null)
        }

        setOverlayHandler(showNextWarning)
        setDismissHandler(showNextWarning)
        toggleOverlay(true, true)
    } else {
        toggleOverlay(false)
    }
}

ipcRenderer.on('system-warnings', (event, warnings) => {
    if (warnings && warnings.length > 0) {
        warningQueue = warnings
        showNextWarning()
    }
})