/**
 * Script for landing.ejs
 */
// Requirements
const { URL } = require('url')
const { MojangRestAPI } = require('./assets/js/core/mojang/MojangRestAPI')
const { getServerStatus } = require('./assets/js/core/mojang/ServerStatusAPI')
const {
    RestResponseStatus,
    isDisplayableError
} = require('./assets/js/core/common/RestResponse')
const { validateLocalFile } = require('./assets/js/core/common/FileUtils')
const { FullRepair } = require('./assets/js/core/dl/FullRepair')
const { DistributionIndexProcessor } = require('./assets/js/core/dl/DistributionIndexProcessor')
const { MojangIndexProcessor } = require('./assets/js/core/dl/MojangIndexProcessor')
const { downloadFile } = require('./assets/js/core/dl/DownloadEngine')
var {
    latestOpenJDK,
    ensureJavaDirIsRoot
} = require('./assets/js/core/java/JavaGuard')


// Internal Requirements
const ProcessBuilder = require('./assets/js/processbuilder')
require('./assets/js/core/util/SentryWrapper.js')

// Launch Elements
const launch_content = document.getElementById('launch_content')
const launch_details = document.getElementById('launch_details')
const launch_progress = document.getElementById('launch_progress')
const launch_progress_label = document.getElementById('launch_progress_label')
const launch_details_text = document.getElementById('launch_details_text')
const server_selection_button = document.getElementById('server_selection_button')
const user_text = document.getElementById('user_text')
const p2p_status = document.getElementById('p2p_status')
const p2p_status_text = document.getElementById('p2p_status_text')

const loggerLanding = LoggerUtil.getLogger('Landing')

/* Launch Progress Wrapper Functions */

/**
 * Show/hide the loading area.
 *
 * @param {boolean} loading True if the loading area should be shown, otherwise false.
 */
function toggleLaunchArea(loading) {
    if (loading) {
        launch_details.style.display = 'flex'
        launch_content.style.display = 'none'
    } else {
        launch_details.style.display = 'none'
        launch_content.style.display = 'inline-flex'
    }
}

/**
 * Set the details text of the loading area.
 *
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details) {
    launch_details_text.innerHTML = details
}

/**
 * Set the value of the loading progress bar and display that value.
 *
 * @param {number} percent Percentage (0-100)
 */
function setLaunchPercentage(percent) {
    launch_progress.setAttribute('max', 100)
    launch_progress.setAttribute('value', percent)
    launch_progress_label.innerHTML = Math.round(percent instanceof Number ? percent : parseFloat(percent)) + '%'
}

/**
 * Set the value of the OS progress bar and display that on the UI.
 *
 * @param {number} percent Percentage (0-100)
 */
function setDownloadPercentage(percent) {
    remote.getCurrentWindow().setProgressBar(percent / 100)
    setLaunchPercentage(percent)
}

// Launch Button Logic Removed (moved to uibinder.js)

// Bind P2P Status
// Bind P2P Status



// Poll P2P Status every 5 seconds
setInterval(async () => {
    try {
        const stats = await ipcRenderer.invoke('p2p:getInfo')
        const count = stats.connections
        if (count > 0) {
            p2p_status.style.display = 'flex'
            p2p_status_text.innerHTML = `P2P (${count})`
        } else {
            p2p_status.style.display = 'none'
        }
    } catch (e) { }
}, 5000)

// Bind launch button
document.getElementById('launch_button').addEventListener('click', async e => {
    loggerLanding.info('Launching game..')
    try {
        const distro = await DistroAPI.getDistribution()
        if (distro == null) {
            showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.noDistributionIndex'))
            return
        }
        const server = distro.getServerById(ConfigManager.getSelectedServer())
        if (server == null) {
            showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.noServerSelected'))
            return
        }
        const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
        if (jExe == null) {
            await asyncSystemScan(server.effectiveJavaOptions)
        } else {

            setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
            toggleLaunchArea(true)
            setLaunchPercentage(0, 100)

            const details = await ipcRenderer.invoke('sys:validateJava', ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
            if (details != null) {
                loggerLanding.info('Jvm Details', details)
                await dlAsync()

            } else {
                await asyncSystemScan(server.effectiveJavaOptions)
            }
        }
    } catch (err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
})

// Bind settings button
document.getElementById('settingsMediaButton').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings)
}

// Bind avatar overlay button.
document.getElementById('avatarOverlay').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
        settingsNavItemListener(document.getElementById('settingsNavAccount'), false)
    })
}

// Bind selected account
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Bind selected server
// Real text is set in uibinder.js on distributionIndexDone.
server_selection_button.innerHTML = '&#8226; ' + Lang.queryJS('landing.selectedServer.loading')
server_selection_button.onclick = async e => {
    e.target.blur()
    await toggleServerSelection(true)
}

// Update Mojang Status Color
const refreshMojangStatuses = async function () {
    loggerLanding.info('Refreshing Mojang Statuses..')

    let status = 'grey'
    let tooltipEssentialHTML = ''
    let tooltipNonEssentialHTML = ''

    const response = await MojangRestAPI.status()
    let statuses
    if (response.responseStatus === RestResponseStatus.SUCCESS) {
        statuses = response.data
    } else {
        loggerLanding.warn('Unable to refresh Mojang service status.')
        statuses = MojangRestAPI.getDefaultStatuses()
    }

    greenCount = 0
    greyCount = 0

    for (let i = 0; i < statuses.length; i++) {
        const service = statuses[i]
        const safeName = service.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;")

        const tooltipHTML = `<div class="mojangStatusContainer">
            <span class="mojangStatusIcon" style="color: ${MojangRestAPI.statusToHex(service.status)};">&#8226;</span>
            <span class="mojangStatusName">${safeName}</span>
        </div>`
        if (service.essential) {
            tooltipEssentialHTML += tooltipHTML
        } else {
            tooltipNonEssentialHTML += tooltipHTML
        }

        if (service.status === 'yellow' && status !== 'red') {
            status = 'yellow'
        } else if (service.status === 'red') {
            status = 'red'
        } else {
            if (service.status === 'grey') {
                ++greyCount
            }
            ++greenCount
        }

    }

    if (greenCount === statuses.length) {
        if (greyCount === statuses.length) {
            status = 'grey'
        } else {
            status = 'green'
        }
    }

    document.getElementById('mojangStatusEssentialContainer').innerHTML = tooltipEssentialHTML
    document.getElementById('mojangStatusNonEssentialContainer').innerHTML = tooltipNonEssentialHTML
    document.getElementById('mojang_status_icon').style.color = MojangRestAPI.statusToHex(status)
}

const refreshServerStatus = async (fade = false) => {
    loggerLanding.info('Refreshing Server Status')
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    let pLabel = Lang.queryJS('landing.serverStatus.server')
    let pVal = Lang.queryJS('landing.serverStatus.offline')

    try {

        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        console.log(servStat)
        pLabel = Lang.queryJS('landing.serverStatus.players')
        pVal = servStat.players.online + '/' + servStat.players.max

    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline.')
        loggerLanding.debug(err)
    }
    if (fade) {
        fadeOut(document.getElementById('server_status_wrapper'), 250, () => {
            document.getElementById('landingPlayerLabel').innerHTML = pLabel
            document.getElementById('player_count').innerHTML = pVal
            fadeIn(document.getElementById('server_status_wrapper'), 500)
        })
    } else {
        document.getElementById('landingPlayerLabel').innerHTML = pLabel
        document.getElementById('player_count').innerHTML = pVal
    }

}

/**
 * Shows an error overlay, toggles off the launch area.
 *
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc) {
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/**
 * Shows the offline warning overlay.
 */
async function showOfflineWarning() {
    return new Promise((resolve) => {
        setOverlayContent(
            Lang.queryJS('landing.launch.serverUnavailableTitle'),
            Lang.queryJS('landing.launch.serverUnavailableDesc'),
            Lang.queryJS('landing.launch.serverUnavailableOkay')
        )
        setOverlayHandler(() => {
            toggleOverlay(false)
            resolve()
        })
        toggleOverlay(true)
    })
}

/* System (Java) Scan */

// Keep reference to Minecraft Process
let proc
// Is DiscordRPC enabled
// Joined server regex
// Change this if your server uses something different.
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+)$/
const MIN_LINGER = 5000

/* System (Java) Scan */

/**
 * Asynchronously scan the system for valid Java installations.
 *
 * @param {boolean} launchAfter Whether we should begin to launch after scanning.
 */
async function asyncSystemScan(effectiveJavaOptions, launchAfter = true) {

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    // IPC Call to Main Process
    const jvmDetails = await ipcRenderer.invoke('sys:scanJava', {
        version: effectiveJavaOptions.supported
    })

    if (jvmDetails == null) {
        // If the result is null, no valid Java installation was found.
        // Show this information to the user.
        setOverlayContent(
            Lang.queryJS('landing.systemScan.noCompatibleJava'),
            Lang.queryJS('landing.systemScan.installJavaMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
            Lang.queryJS('landing.systemScan.installJava'),
            Lang.queryJS('landing.systemScan.installJavaManually')
        )
        setOverlayHandler(() => {
            setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
            toggleOverlay(false)

            try {
                downloadJava(effectiveJavaOptions, launchAfter)
            } catch (err) {
                loggerLanding.error('Unhandled error in Java Download', err)
                showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
            }
        })
        setDismissHandler(() => {
            fadeOut(document.getElementById('overlayContent'), 250, () => {

                setOverlayContent(
                    Lang.queryJS('landing.systemScan.javaRequired', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredDismiss'),
                    Lang.queryJS('landing.systemScan.javaRequiredCancel')
                )
                setOverlayHandler(() => {
                    toggleLaunchArea(false)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false, true)

                    asyncSystemScan(effectiveJavaOptions, launchAfter)
                })
                fadeIn(document.getElementById('overlayContent'), 250)
            })
        })
        toggleOverlay(true, true)
    } else {
        // Java installation found, use this to launch the game.
        // We assume Main process returns the full path including executable
        let javaExec = jvmDetails.path
        if (jvmDetails.executable) javaExec = jvmDetails.executable // If object returned

        // Ensure we get the executable path if the scanner returns the home dir
        if (!javaExec.endsWith('java') && !javaExec.endsWith('java.exe') && !javaExec.endsWith('javaw.exe')) {
            // We can't resolve this easily in Renderer without path/fs access if we are strict.
            // But we still have nodeIntegration for now.
            const { javaExecFromRoot } = require('./assets/js/core/java/JavaGuard')
            javaExec = javaExecFromRoot(javaExec)
        }

        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()

        // We need to make sure that the updated value is on the settings UI.
        // Just incase the settings UI is already open.
        settingsJavaExecVal.value = javaExec
        await populateJavaExecDetails(settingsJavaExecVal.value)

        if (launchAfter) {
            await dlAsync()
        }
    }

}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {
    if (!effectiveJavaOptions) effectiveJavaOptions = {}

    // Temporary: Use a hardcoded object if effectiveJavaOptions is empty or mismatched,
    // assuming standard key names from the distro logic.
    // effectiveJavaOptions usually has: { platform, architecture, majorVersion (or suggestedMajor) }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch')) // Generic "Preparing..."
    toggleLaunchArea(true)
    setLaunchPercentage(0)

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    // Listen for progress
    const progressListener = (event, status) => {
        if (status.type === 'download') {
            setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles')) // Reuse "Downloading Files"
            setDownloadPercentage(status.progress)
        } else if (status.type === 'extract') {
            setLaunchDetails('Extracting Java...') // Hardcoded or new Lang key
            setLaunchPercentage(100)
        }
    }
    ipcRenderer.on('dl:progress', progressListener)

    try {
        // Invoke Main
        const javaPath = await ipcRenderer.invoke('dl:downloadJava', {
            major: effectiveJavaOptions.majorVersion || effectiveJavaOptions.suggestedMajor || 8,
            distribution: effectiveJavaOptions.distribution || null
        })

        // Success
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaPath)
        ConfigManager.save()

        if (document.getElementById('settingsJavaExecVal')) {
            document.getElementById('settingsJavaExecVal').value = javaPath
            await populateJavaExecDetails(javaPath)
        }

        ipcRenderer.removeListener('dl:progress', progressListener)

        if (launchAfter) {
            await dlAsync()
        }

    } catch (err) {
        ipcRenderer.removeListener('dl:progress', progressListener)
        loggerLaunchSuite.error('Error downloading Java via Main Process.', err)
        showLaunchFailure('Java Download Failed', err.message || 'Check console codes.')
    }
}


async function dlAsync(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    let isOfflineLaunch = false

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch (err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    if (login) {
        if (ConfigManager.getSelectedAccount() == null) {
            loggerLanding.error('You must be logged into an account.')
            toggleLaunchArea(false) // FIX: Reset UI
            return
        }
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    // Listen for progress from Main
    const progressListener = (event, status) => {
        if (status.type === 'verify') {
            setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
            setLaunchPercentage(status.progress)
        } else if (status.type === 'download') {
            setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
            setDownloadPercentage(status.progress)
        }
    }
    ipcRenderer.on('dl:progress', progressListener)

    try {
        // Invoke Main Process Download
        await ipcRenderer.invoke('dl:start', {
            serverId: ConfigManager.getSelectedServer(),
            version: serv.rawServer.minecraftVersion
        })

        // Success
        setDownloadPercentage(100)
        ipcRenderer.removeListener('dl:progress', progressListener)

    } catch (err) {
        ipcRenderer.removeListener('dl:progress', progressListener)
        loggerLaunchSuite.warn('Error during file download via Main Process.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.message || 'Download Failed')
        return
    }

    // Receiver destruction moved to Main.

    if (isOfflineLaunch) {
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingOffline'))
    } else {
        setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))
    }

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
    await mojangIndexProcessor.init()
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id
    )

    let modLoaderData
    try {
        modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    } catch (err) {
        loggerLaunchSuite.error('Error loading ModLoader data', err)
        if (isOfflineLaunch || DistroAPI._remoteFailed) {
            showLaunchFailure(Lang.queryJS('landing.dlAsync.launchingOffline'), 'Required ModLoader files are missing! Cannot launch offline.<br>Please connect to the internet and try again.')
            return
        } else {
            showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), 'Failed to load ModLoader version data.<br>' + err.message)
            return
        }
    }
    let versionData
    let mojangOffline = false
    try {
        versionData = await mojangIndexProcessor.getVersionJson()
    } catch (err) {
        loggerLaunchSuite.warn('Unable to load Mojang version data, attempting to load from local cache.', err)
        versionData = await mojangIndexProcessor.getLocalVersionJson()
        if (!versionData) {
            loggerLaunchSuite.error('Unable to load Mojang version data from local cache.')
            showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadMojangVersionData'))
            return
        }
        mojangOffline = true
    }

    if (DistroAPI._remoteFailed || isOfflineLaunch || mojangOffline) {
        showOfflineWarning()
    }

    if (login) {
        const authUser = ConfigManager.getSelectedAccount()
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))

        // const SERVER_JOINED_REGEX = /\[.+\]: \[CHAT\] [a-zA-Z0-9_]{1,16} joined the game/
        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

        const onLoadComplete = () => {
            toggleLaunchArea(false)
            proc.stdout.removeListener('data', tempListener)
            proc.stderr.removeListener('data', gameErrorListener)
        }
        const start = Date.now()

        // Attach a temporary listener to the client output.
        // Will wait for a certain bit of text meaning that
        // the client application has started, and we can hide
        // the progress bar stuff.
        const tempListener = function (data) {
            if (GAME_LAUNCH_REGEX.test(data.trim())) {
                const diff = Date.now() - start
                if (diff < MIN_LINGER) {
                    setTimeout(onLoadComplete, MIN_LINGER - diff)
                } else {
                    onLoadComplete()
                }
            }
        }

        const gameErrorListener = function (data) {
            data = data.trim()
            if (data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1) {
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }

        try {
            // Build Minecraft process.
            proc = await pb.build()

            // Bind listeners to stdout.
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)

            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))

            // FIX: Watch for early exit (Crash on Startup)
            // If the process exits before we detect "Game Started", reset the UI.
            proc.on('exit', (code, signal) => {
                // If onLoadComplete hasn't fired (UI is still showing launch details), close it.
                if (launch_details.style.display !== 'none') {
                    loggerLaunchSuite.warn(`Game exited early with code ${code}. Resetting UI.`)
                    toggleLaunchArea(false)
                    // Optional: Show error if code != 0? 
                    // Usually stderr listener catches the specific error, but this ensures UI doesn't hang.
                    // If clean exit (0), maybe they just closed it fast, but still reset UI.
                }
            })


        } catch (err) {

            loggerLaunchSuite.error('Error during launch', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))

        }
    }

}

// Bind news button.
document.getElementById('newsButton').onclick = async () => {
    const path = require('path')
    const { shell } = require('electron')
    try {
        const distro = await DistroAPI.getDistribution()
        const serv = distro.getServerById(ConfigManager.getSelectedServer())
        if (serv) {
            const serverId = serv.rawServer.id
            const instancePath = path.join(ConfigManager.getInstanceDirectory(), serverId)
            await shell.openPath(instancePath)
        }
    } catch (err) {
        loggerLanding.error('Error opening instance directory.', err)
    }
}
