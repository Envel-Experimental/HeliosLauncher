/**
 * Initialize UI functions which depend on internal modules.
 * Loaded after core UI functions are initialized in uicore.js.
 */
// Requirements
const { Type } = require('@core/common/DistributionClasses')

const AuthManager = require('@core/authmanager')
const ConfigManager = require('@core/configmanager')
const DistroManager = require('@core/distromanager')

console.log('[UIBinder] Module Loading...')


export let rscShouldLoad = false
export let fatalStartupError = false

// Mapping of each view to their container IDs.
export const VIEWS = {
    landing: '#landingContainer',
    loginOptions: '#loginOptionsContainer',
    login: '#loginContainer',
    settings: '#settingsContainer',
    welcome: '#welcomeContainer',
    waiting: '#waitingContainer'
}

// The currently shown view container.
export let currentView

// Shared view-control variables (must be global for cross-module access)
window.loginViewOnSuccess = VIEWS.landing
window.loginViewOnCancel = VIEWS.settings
window.loginViewCancelHandler = null

window.loginOptionsViewOnLoginSuccess = VIEWS.landing
window.loginOptionsViewOnLoginCancel = VIEWS.loginOptions
window.loginOptionsViewOnCancel = VIEWS.landing
window.loginOptionsViewCancelHandler = null

// Legacy Global Exposure
window.VIEWS = VIEWS
window.switchView = switchView
window.getCurrentView = () => currentView
window.fatalStartupError = fatalStartupError
// window.prepareSettings is handled in settings.js
// Note: currentView update is handled in switchView function below

/**
 * Switch launcher views.
 *
 * @param {string} current The ID of the current view container.
 * @param {*} next The ID of the next view container.
 * @param {*} currentFadeTime Optional. The fade out time for the current view.
 * @param {*} nextFadeTime Optional. The fade in time for the next view.
 * @param {*} onCurrentFade Optional. Callback function to execute when the current
 * view fades out.
 * @param {*} onNextFade Optional. Callback function to execute when the next view
 * fades in.
 */
export function switchView(current, next, currentFadeTime = 500, nextFadeTime = 500, onCurrentFade = () => { }, onNextFade = () => { }) {
    console.log(`[UIBinder] Switching view: ${current} -> ${next}`)
    currentView = next
    fadeOut(document.querySelector(current), currentFadeTime, async () => {
        try {
            await onCurrentFade()
        } catch (err) {
            console.error(`[UIBinder] Error in onCurrentFade for ${next}:`, err)
        }
        
        fadeIn(document.querySelector(next), nextFadeTime, async () => {
            try {
                await onNextFade()
            } catch (err) {
                console.error(`[UIBinder] Error in onNextFade for ${next}:`, err)
            }
            if (next === VIEWS.landing) {
                checkAndShowP2PPrompt()
            }
        })
    })
}

/**
 * Get the currently shown view container.
 *
 * @returns {string} The currently shown view container.
 */
export function getCurrentView() {
    return currentView
}

/**
 * Enable or disable the launch button.
 *
 * @param {boolean} val True to enable, false to disable.
 */
export function setLaunchEnabled(val) {
    document.getElementById('launch_button').disabled = !val
}

/**
 * Bind selected server
 */
export async function updateSelectedServer(serv) {
    if (getCurrentView() === VIEWS.settings) {
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    await ConfigManager.save()
    const serverSelectionBtn = document.getElementById('server_selection_button')
    serverSelectionBtn.innerHTML = (serv != null ? serv.rawServer.name : Lang.queryJS('landing.noSelection'))
    if (getCurrentView() === VIEWS.settings) {
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
}

/**
 * Bind selected account
 */
export function updateSelectedAccount(authUser) {
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    if (authUser != null) {
        if (authUser.displayName != null) {
            username = authUser.displayName
        }
        if (authUser.uuid != null) {
            const avatarContainer = document.getElementById('avatarContainer')
            if (avatarContainer) avatarContainer.style.backgroundImage = `url('https://mc-heads.net/body/${authUser.uuid}/right')`
        }
    }
    const userText = document.getElementById('user_text')
    if (userText) userText.innerHTML = username
}

export async function showMainUI(data) {
    const _isDev = window.isDev || (typeof isDev !== 'undefined' ? isDev : false)
    if (!_isDev) {
        if (window.loggerAutoUpdater) {
            window.loggerAutoUpdater.info('Initializing..')
        }
        ipcRenderer.send('autoUpdateAction', 'initAutoUpdater', ConfigManager.getAllowPrerelease())
    }



    // 1. Initial Server Selection (MUST be before prepareSettings)
    let selectedServ = data.getServerById(ConfigManager.getSelectedServer())
    if (selectedServ == null) {
        selectedServ = data.getMainServer()
        if (selectedServ) {
            console.log('[UIBinder] Auto-selecting main server:', selectedServ.rawServer.id)
            ConfigManager.setSelectedServer(selectedServ.rawServer.id)
            await ConfigManager.save()
        }
    }

    console.log('[UIBinder] Preparing settings...')
    await prepareSettings(true)
    console.log('[UIBinder] Settings prepared.')
    
    let selectedAcc = ConfigManager.getSelectedAccount()
    if (selectedAcc == null) {
        const accounts = ConfigManager.getAuthAccounts()
        const keys = Object.keys(accounts)
        if (keys.length > 0) {
            ConfigManager.setSelectedAccount(keys[0])
            selectedAcc = ConfigManager.getSelectedAccount()
            await ConfigManager.save()
        }
    }
    console.log('[UIBinder] Updating selected account to:', selectedAcc?.displayName)
    updateSelectedAccount(selectedAcc)

    console.log('[UIBinder] Updating selected server to:', selectedServ?.rawServer?.id)
    await updateSelectedServer(selectedServ)

    if (data.rawDistribution.supportUrl) {
        ConfigManager.setSupportUrl(data.rawDistribution.supportUrl)
    }
    setTimeout(async () => {
        console.log('[UIBinder] Showing main container...')
        document.getElementById('frameBar').style.backgroundColor = 'rgba(0, 0, 0, 0.5)'
        document.body.style.backgroundImage = `url('assets/images/backgrounds/${document.body.getAttribute('bkid')}.jpg')`
        show(document.getElementById('main'))
        console.log('[UIBinder] Main container visibility set to show.')
        
        // Ensure launch area is shown (not in loading state)
        if (typeof window.toggleLaunchArea === 'function') {
            window.toggleLaunchArea(false)
        }

        const isLoggedIn = Object.keys(ConfigManager.getAuthAccounts()).length > 0

        // If this is enabled in a development environment we'll get ratelimited.
        // The relaunch frequency is usually far too high.
        if (!isDev && isLoggedIn) {
            validateSelectedAccount()
        }

        if (ConfigManager.isFirstLaunch()) {
            console.log('[UIBinder] First launch detected. Jumping directly to nickname login.')
            loginCancelEnabled(false)
            window.loginViewOnSuccess = VIEWS.landing
            window.loginViewOnCancel = VIEWS.loginOptions
            currentView = VIEWS.login
            const loginEl = document.querySelector(VIEWS.login)
            if (loginEl) show(loginEl)
        } else {
            if (isLoggedIn) {
                currentView = VIEWS.landing
                const landingEl = document.querySelector(VIEWS.landing)
                if (landingEl) {
                    show(landingEl)
                    console.log('[UIBinder] Landing container shown.')
                    const distro = await DistroAPI.getDistribution()
                    if (distro) {
                        console.log('[UIBinder] Distribution loaded, initializing landing...')
                        onDistroRefresh(distro)
                    } else {
                        console.warn('[UIBinder] Distribution failed to load, showing landing in limited mode.')
                    }
                    toggleLaunchArea(false)
                    checkAndShowP2PPrompt()
                }
            } else {
                loginOptionsCancelEnabled(false)
                window.loginOptionsViewOnLoginSuccess = VIEWS.landing
                window.loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                currentView = VIEWS.loginOptions
                const loginOptionsEl = document.querySelector(VIEWS.loginOptions)
                if (loginOptionsEl) show(loginOptionsEl)
            }
        }

        setTimeout(() => {
            fadeOut(document.getElementById('loadingContainer'), 500, () => {
                const spinner = document.getElementById('loadSpinnerImage')
                if (spinner) {
                    spinner.classList.remove('rotating')
                }
            })
        }, 250)

    }, 750)
}

export function showFatalStartupError() {
    setTimeout(() => {
        fadeOut(document.getElementById('loadingContainer'), 250, () => {
            document.getElementById('overlayContainer').style.background = 'none'
            setOverlayContent(
                Lang.queryJS('uibinder.startup.fatalErrorTitle'),
                Lang.queryJS('uibinder.startup.fatalErrorMessage'),
                Lang.queryJS('uibinder.startup.closeButton')
            )
            setOverlayHandler(() => {
                HeliosAPI.window.close()
            })
            toggleOverlay(true)
        })
    }, 750)
}

/**
 * Common functions to perform after refreshing the distro index.
 *
 * @param {Object} data The distro index object.
 */
export async function onDistroRefresh(data) {

    if (!data) return

    let selectedServ = data.getServerById(ConfigManager.getSelectedServer())
    if (selectedServ == null) {
        selectedServ = data.getMainServer()
    }
    await updateSelectedServer(selectedServ)
    syncModConfigurations(data)
    ensureJavaSettings(data)
}

/**
 * Sync the mod configurations with the distro index.
 *
 * @param {Object} data The distro index object.
 */
export async function syncModConfigurations(data) {

    const syncedCfgs = {}

    for (let serv of data.servers) {

        const id = serv.rawServer.id
        const mdls = serv.modules
        const cfg = ConfigManager.getModConfiguration(id)

        if (cfg != null && cfg.mods != null) {

            const modsOld = cfg.mods
            const mods = {}

            for (let mdl of mdls) {
                const type = mdl.rawModule.type

                if (type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod) {
                    if (!mdl.getRequired().value) {
                        const mdlID = mdl.getVersionlessMavenIdentifier()
                        if (modsOld[mdlID] == null) {
                            mods[mdlID] = scanOptionalSubModules(mdl.subModules, mdl)
                        } else {
                            mods[mdlID] = mergeModConfiguration(modsOld[mdlID], scanOptionalSubModules(mdl.subModules, mdl), false)
                        }
                    } else {
                        if (mdl.subModules.length > 0) {
                            const mdlID = mdl.getVersionlessMavenIdentifier()
                            const v = scanOptionalSubModules(mdl.subModules, mdl)
                            if (typeof v === 'object') {
                                if (modsOld[mdlID] == null) {
                                    mods[mdlID] = v
                                } else {
                                    mods[mdlID] = mergeModConfiguration(modsOld[mdlID], v, true)
                                }
                            }
                        }
                    }
                }
            }

            syncedCfgs[id] = {
                mods
            }

        } else {

            const mods = {}

            for (let mdl of mdls) {
                const type = mdl.rawModule.type
                if (type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod) {
                    if (!mdl.getRequired().value) {
                        mods[mdl.getVersionlessMavenIdentifier()] = scanOptionalSubModules(mdl.subModules, mdl)
                    } else {
                        if (mdl.subModules.length > 0) {
                            const v = scanOptionalSubModules(mdl.subModules, mdl)
                            if (typeof v === 'object') {
                                mods[mdl.getVersionlessMavenIdentifier()] = v
                            }
                        }
                    }
                }
            }

            syncedCfgs[id] = {
                mods
            }

        }
    }

    ConfigManager.setModConfigurations(syncedCfgs)
    await ConfigManager.save()
}

/**
 * Ensure java configurations are present for the available servers.
 *
 * @param {Object} data The distro index object.
 */
export async function ensureJavaSettings(data) {

    // Nothing too fancy for now.
    if (window.setLoadingStatus) {
        window.setLoadingStatus('js.uibinder.loading.checkingJava')
    }
    for (const serv of data.servers) {
        ConfigManager.ensureJavaConfig(serv.rawServer.id, serv.effectiveJavaOptions, serv.rawServer.javaOptions?.ram)
    }

    await ConfigManager.save()
}

/**
 * Recursively scan for optional sub modules. If none are found,
 * this function returns a boolean. If optional sub modules do exist,
 * a recursive configuration object is returned.
 *
 * @returns {boolean | Object} The resolved mod configuration.
 */
export function scanOptionalSubModules(mdls, origin) {
    if (mdls != null) {
        const mods = {}

        for (let mdl of mdls) {
            const type = mdl.rawModule.type
            // Optional types.
            if (type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod) {
                // It is optional.
                const mdlID = mdl.getVersionlessMavenIdentifier()
                const mdlName = (typeof mdl.rawModule.name === 'string' ? mdl.rawModule.name : (mdl.rawModule.name?.value || 'Unknown Mod'))
                
                if (!mdl.getRequired().value) {
                    mods[mdlID] = scanOptionalSubModules(mdl.subModules, mdl)
                } else {
                    if (mdl.hasSubModules()) {
                        const v = scanOptionalSubModules(mdl.subModules, mdl)
                        if (typeof v === 'object') {
                            mods[mdlID] = v
                        }
                    }
                }
            }
        }

        if (Object.keys(mods).length > 0) {
            const ret = {
                mods
            }
            if (!origin.getRequired().value) {
                ret.value = origin.getRequired().def
            }
            return ret
        }
    }
    return origin.getRequired().def
}

/**
 * Recursively merge an old configuration into a new configuration.
 *
 * @param {boolean | Object} o The old configuration value.
 * @param {boolean | Object} n The new configuration value.
 * @param {boolean} nReq If the new value is a required mod.
 *
 * @returns {boolean | Object} The merged configuration.
 */
export function mergeModConfiguration(o, n, nReq = false) {
    if (typeof o === 'boolean') {
        if (typeof n === 'boolean') return o
        else if (typeof n === 'object') {
            if (!nReq) {
                n.value = o
            }
            return n
        }
    } else if (typeof o === 'object') {
        if (typeof n === 'boolean') return typeof o.value !== 'undefined' ? o.value : true
        else if (typeof n === 'object') {
            if (!nReq) {
                n.value = typeof o.value !== 'undefined' ? o.value : true
            }

            const newMods = Object.keys(n.mods)
            for (let i = 0; i < newMods.length; i++) {

                const mod = newMods[i]
                if (o.mods[mod] != null) {
                    n.mods[mod] = mergeModConfiguration(o.mods[mod], n.mods[mod])
                }
            }

            return n
        }
    }
    // If for some reason we haven't been able to merge,
    // wipe the old value and use the new one. Just to be safe
    return n
}

async function validateSelectedAccount() {
    try {
        const selectedAcc = ConfigManager.getSelectedAccount()
        if (selectedAcc != null) {
            const val = await AuthManager.validateSelected()
            if (!val) {
                ConfigManager.removeAuthAccount(selectedAcc.uuid)
                ConfigManager.save()
                const accLen = Object.keys(ConfigManager.getAuthAccounts()).length
                setOverlayContent(
                    Lang.queryJS('uibinder.validateAccount.failedMessageTitle'),
                    accLen > 0
                        ? Lang.queryJS('uibinder.validateAccount.failedMessage', { 'account': selectedAcc.displayName })
                        : Lang.queryJS('uibinder.validateAccount.failedMessageSelectAnotherAccount', { 'account': selectedAcc.displayName }),
                    Lang.queryJS('uibinder.validateAccount.loginButton'),
                    Lang.queryJS('uibinder.validateAccount.selectAnotherAccountButton')
                )
                setOverlayHandler(() => {

                    const isMicrosoft = selectedAcc.type === 'microsoft'

                    if (isMicrosoft) {
                        // Empty for now
                    } else {
                        // Mojang
                        // For convenience, pre-populate the username of the account.
                        document.getElementById('loginUsername').value = selectedAcc.username
                        validateEmail(selectedAcc.username)
                    }

                    window.loginOptionsViewOnLoginSuccess = getCurrentView()
                    window.loginOptionsViewOnLoginCancel = VIEWS.loginOptions

                    if (accLen > 0) {
                        window.loginOptionsViewOnCancel = getCurrentView()
                        window.loginOptionsViewCancelHandler = () => {
                            if (isMicrosoft) {
                                ConfigManager.addMicrosoftAuthAccount(
                                    selectedAcc.uuid,
                                    selectedAcc.accessToken,
                                    selectedAcc.username,
                                    selectedAcc.expiresAt,
                                    selectedAcc.microsoft.access_token,
                                    selectedAcc.microsoft.refresh_token,
                                    selectedAcc.microsoft.expires_at
                                )
                            } else {
                                ConfigManager.addMojangAuthAccount(selectedAcc.uuid, selectedAcc.accessToken, selectedAcc.username, selectedAcc.displayName)
                            }
                            ConfigManager.save()
                            validateSelectedAccount()
                        }
                        loginOptionsCancelEnabled(true)
                    } else {
                        loginOptionsCancelEnabled(false)
                    }
                    toggleOverlay(false)
                    switchView(getCurrentView(), VIEWS.loginOptions)
                })
                setDismissHandler(() => {
                    if (accLen > 1) {
                        prepareAccountSelectionList()
                        fadeOut(document.getElementById('overlayContent'), 250, () => {
                            bindOverlayKeys(true, 'accountSelectContent', true)
                            fadeIn(document.getElementById('accountSelectContent'), 250)
                        })
                    } else {
                        const accountsObj = ConfigManager.getAuthAccounts()
                        const accounts = Array.from(Object.keys(accountsObj), v => accountsObj[v])
                        // This function validates the account switch.
                        setSelectedAccount(accounts[0].uuid)
                        toggleOverlay(false)
                    }
                })
                toggleOverlay(true, accLen > 0)
            } else {
                return true
            }
        } else {
            return true
        }
    } catch (error) {
        console.error('[UIBinder] Failed to validate selected account:', error)
        // If it's a network error or transient issue, don't remove the account
        // This prevents an infinite loop back to login on temporary connection issues.
        return true 
    }
}

/**
 * Temporary function to update the selected account along
 * with the relevent UI elements.
 *
 * @param {string} uuid The UUID of the account.
 */
async function setSelectedAccount(uuid) {
    const authAcc = ConfigManager.setSelectedAccount(uuid)
    await ConfigManager.save()
    updateSelectedAccount(authAcc)
    validateSelectedAccount()
}

// Synchronous Listener
document.addEventListener('readystatechange', async () => {

    if (document.readyState === 'interactive' || document.readyState === 'complete') {
        if (rscShouldLoad) {
            rscShouldLoad = false
            if (!fatalStartupError) {
                const data = await DistroManager.getDistribution()
                await showMainUI(data)
            } else {
                showFatalStartupError()
            }
        }
    }

}, false)

// Actions that must be performed after the distribution index is downloaded.
ipcRenderer.on('distributionIndexDone', async (event, res) => {
    console.log('[UIBinder] Received distributionIndexDone signal:', res)
    try {
        if (res) {
            if (window.setLoadingStatus) {
                window.setLoadingStatus('js.uibinder.loading.distributionSync')
            }
            console.log('[UIBinder] Fetching distribution data...')
            const data = await DistroManager.getDistribution()

            if (!data) {
                throw new Error('Distribution data is null or undefined.')
            }

            console.log('[UIBinder] Distribution data loaded. Syncing configs...')
            try {
                await syncModConfigurations(data)
                await ensureJavaSettings(data)
            } catch (err) {
                console.warn('[UIBinder] Error during mod/java sync, continuing...', err)
            }
            
            console.log('[UIBinder] Initialization complete. Transitioning to Main UI.')
            if (document.readyState === 'interactive' || document.readyState === 'complete') {
                await showMainUI(data)
            } else {
                rscShouldLoad = true
            }
        } else {
            throw new Error('distributionIndexDone received FALSE result.')
        }
    } catch (err) {
        console.error('[UIBinder] FATAL startup error in distributionIndexDone handler:', err)
        // If we have an error, we should still try to show UI but in a failed state
        fatalStartupError = true
        if (document.readyState === 'interactive' || document.readyState === 'complete') {
            showFatalStartupError()
        } else {
            rscShouldLoad = true
        }
    } finally {
        // ALWAYS ensure launch area is reset if we reached here
        if (typeof window.toggleLaunchArea === 'function') {
            console.log('[UIBinder] Final UI visibility sync: Showing controls.')
            window.toggleLaunchArea(false)
        }
    }
})

/**
 * Handle system power resume
 */
ipcRenderer.on('power-resume', async () => {
    if (!fatalStartupError) {
        const data = await DistroManager.getDistribution()
        if (data) {
            await onDistroRefresh(data)
        }
    }
})

// IPC Listener for cross-process UI calls
ipcRenderer.on('ui:call', (event, { fn, args }) => {
    console.log(`[UIBinder] Received cross-process UI call: ${fn}`, args)

    // Resolve string-based handlers for actions (IPC cannot send functions)
    const processedArgs = args.map(arg => {
        if (typeof arg === 'string' && arg.startsWith('ui:')) {
            const action = arg.substring(3)
            console.log(`[UIBinder] Resolving UI action: ${action}`)

            if (action === 'crash-fix-action') {
                return async () => {
                    console.log('[UIBinder] Executing crash-fix-action')
                    if (typeof window.toggleOverlay === 'function') {
                        window.toggleOverlay(false)
                    } else {
                        console.warn('[UIBinder] window.toggleOverlay is not a function!')
                    }
                    ipcRenderer.send('ui:action', 'crash-fix')
                }
            }
            if (action === 'crash-support-action') {
                return () => {
                    console.log('[UIBinder] Executing crash-support-action')
                    ipcRenderer.send('ui:action', 'crash-support')
                }
            }
            if (action === 'close-overlay') {
                return () => {
                    console.log('[UIBinder] Executing close-overlay action')
                    if (typeof window.toggleOverlay === 'function') {
                        window.toggleOverlay(false)
                    } else {
                        console.warn('[UIBinder] window.toggleOverlay is not a function!')
                    }
                }
            }
        }
        return arg
    })

    if (typeof window[fn] === 'function') {
        window[fn](...processedArgs)
    } else if (typeof exports[fn] === 'function') {
        exports[fn](...processedArgs)
    } else {
        console.warn(`[UIBinder] Received ui:call for unknown function: ${fn}`)
    }
})

// IPC Listener for clicking elements
ipcRenderer.on('ui:clickElement', (event, id) => {
    const el = document.getElementById(id)
    if (el) {
        console.log(`[UIBinder] Simulating click on element: ${id}`)
        el.click()
    } else {
        console.warn(`[UIBinder] Cannot click element: ${id} (not found)`)
    }
})

async function devModeToggle() {
    await DistroManager.toggleDevMode(true)
    const data = await DistroManager.getDistribution()
    await ensureJavaSettings(data)
    await updateSelectedServer(data.servers[0])
    await syncModConfigurations(data)
}



/**
 * Check if the P2P prompt should be showed.
 */
export function checkAndShowP2PPrompt() {
    if (!ConfigManager.getP2PPromptShown() && !isOverlayVisible()) {

        if (ConfigManager.isFirstLaunch()) {
            ConfigManager.setP2PPromptShown(true)
            ConfigManager.setLocalOptimization(true)
            ConfigManager.setGlobalOptimization(true)
            ConfigManager.setP2PUploadEnabled(true)
            ConfigManager.markFirstLaunchCompleted()
            ConfigManager.save()
            ipcRenderer.invoke('p2p:configUpdate')
            return
        }

        const title = Lang.queryJS('uibinder.p2p.promptTitle')
        const desc = Lang.queryJS('uibinder.p2p.promptDesc')
        const enableBtn = Lang.queryJS('uibinder.p2p.enableButton')
        const disableBtn = Lang.queryJS('uibinder.p2p.disableButton')
        const settingsNotice = Lang.queryJS('uibinder.p2p.settingsNotice')

        setOverlayContent(title, desc + '<br><br><span style="color: #aaa; font-size: 12px;">' + settingsNotice + '</span>', enableBtn, disableBtn)

        setOverlayHandler(async () => {
            ConfigManager.setP2PPromptShown(true)
            ConfigManager.setLocalOptimization(true)
            ConfigManager.setGlobalOptimization(true)
            ConfigManager.setP2PUploadEnabled(true)
            ConfigManager.markFirstLaunchCompleted()
            await ConfigManager.save()
            toggleOverlay(false)
            ipcRenderer.invoke('p2p:configUpdate') // Notify Main Process
        })

        setMiddleButtonHandler(async () => {
            ConfigManager.setP2PPromptShown(true)
            ConfigManager.setLocalOptimization(false)
            ConfigManager.setGlobalOptimization(false)
            ConfigManager.setP2PUploadEnabled(false)
            ConfigManager.markFirstLaunchCompleted()
            await ConfigManager.save()
            toggleOverlay(false)
            ipcRenderer.invoke('p2p:configUpdate') // Notify Main Process
        })

        toggleOverlay(true, false)
    }
}

/**
 * Prepare the settings UI.
 * @param {boolean} first Whether this is the first load.
 */
// prepareSettings logic has been moved to settings.js to avoid conflicts and centralization.
// Expose functions to global scope for other modules
window.validateSelectedAccount = validateSelectedAccount
window.setSelectedAccount = setSelectedAccount
window.updateSelectedAccount = updateSelectedAccount
