/**
 * Renderer entry point for bundling
 * Using require() instead of import to ensure strict execution order.
 * Structure: [Stage Zero] -> [Core] -> [UI Core] -> [UI Views] -> [Signal]
 */

// 1. STAGE ZERO: Global polyfills
window.global = window
console.log('Renderer Script Execution Started')

// Platform Detection (Immediate stabilization)
const platform = (window.HeliosAPI && window.HeliosAPI.system) ? window.HeliosAPI.system.getPlatform() : 'win32'
document.body.setAttribute('data-platform', platform)
console.log(`Renderer Platform Stabilized: ${platform}`)

// 1.1 Polyfill process immediately (Essential for libraries and env detection)
if (typeof process === 'undefined') {
    window.process = { 
        platform,
        type: 'renderer',
        env: { HELIOS_DEV_MODE: window.isDev || false },
        nextTick: (fn) => setTimeout(fn, 0)
    }
} else {
    if (!process.platform) process.platform = platform
    if (!process.type) process.type = 'renderer'
    if (!process.nextTick) process.nextTick = (fn) => setTimeout(fn, 0)
}

const { LoggerUtil } = require('./core/util/LoggerUtil')
const Lang = require('./core/langloader')
const ConfigManager = require('./core/configmanager')
const uiUtil = require('./ui/views/ui-util')

// Global error handling for Renderer Process
window.addEventListener('error', (event) => {
    console.error('[Renderer ERROR]', event.error || event.message)
    if (window.HeliosAPI?.ipc) {
        window.HeliosAPI.ipc.send('renderer-error', (event.error ? event.error.stack : event.message))
    }
})

window.addEventListener('unhandledrejection', (event) => {
    console.error('[Renderer ASYNC ERROR]', event.reason)
    if (window.HeliosAPI?.ipc) {
        window.HeliosAPI.ipc.send('renderer-error', (event.reason ? event.reason.stack : event.reason.toString()))
    }
})
const DistroAPI = require('./core/distromanager')
const i18n = require('./ui/i18n.js')

// Export to window immediately
Object.assign(window, {
    LoggerUtil,
    Lang,
    ConfigManager,
    DistroAPI,
    i18n,
    ...uiUtil
})

// 3. STAGE TWO: UI Core Initialization
const uicore = require('./ui/uicore.js')
const uibinder = require('./ui/uibinder.js')

// 4. STAGE THREE: UI View Modules
const landing = require('./ui/views/landing.js')
const settings = require('./ui/views/settings.js')
const welcome = require('./ui/views/welcome.js')
const login = require('./ui/views/login.js')
const loginOptions = require('./ui/views/loginOptions.js')
const overlay = require('./ui/views/overlay.js')

// 5. STAGE FOUR: Global Export Merge
Object.assign(window, uicore)
Object.assign(window, uibinder)
Object.assign(window, landing)
Object.assign(window, loginOptions)
Object.assign(window, overlay)
Object.assign(window, settings)
Object.assign(window, welcome)
Object.assign(window, login)

// 6. STAGE FIVE: Manual Wrapper Linkage
window.setOverlayContent = overlay.setOverlayContent
window.toggleOverlay = overlay.toggleOverlay
window.setOverlayHandler = overlay.setOverlayHandler
window.setMiddleButtonHandler = overlay.setMiddleButtonHandler
window.setDismissHandler = overlay.setDismissHandler

console.log('Renderer Bootstrap Phase 1 Complete (Structural Reorg)')

// Initialize Languages immediately before config load
try {
    Lang.setupLanguage()
    if (window.setLoadingStatus) {
        window.setLoadingStatus('js.uibinder.loading.loadingConfig')
    }
    console.log('Renderer Language Engine Initialized.')
} catch (e) {
    console.error('Failed to initialize language engine:', e)
    if (e.stack) console.error(e.stack)
}

console.log('Renderer Bootstrap Phase 2: Loading Configuration...')
ConfigManager.load().then(async () => {
    console.log('Renderer Configuration Eagerly Loaded.')
    
    // Polyfill EJS functionality
    try {
        i18n.applyTranslations()
    } catch (e) {
        console.warn('Failed to apply initial translations:', e)
    }

    // Set platform attribute
    const platform = window.HeliosAPI?.system?.getPlatform() || process.platform || 'win32'
    document.body.setAttribute('data-platform', platform)
    
    // process polyfill moved to top stage zero

    const bkid = Math.floor(Math.random() * 5) // roughly 5 backgrounds in assets
    document.body.setAttribute('bkid', bkid.toString())
    console.log(`Renderer Background Set: ${bkid}`)
    
    // Detect OS and set attribute for CSS targeting
    document.body.setAttribute('data-platform', platform)
    
    // Hardened window frame visibility based on platform
    const frameDarwin = document.getElementById('frameContentDarwin')
    const frameWin = document.getElementById('frameContentWin')
    
    if (platform === 'darwin') {
        if (frameDarwin) frameDarwin.style.display = 'flex'
        if (frameWin) frameWin.style.display = 'none'
    } else {
        if (frameDarwin) frameDarwin.style.display = 'none'
        if (frameWin) frameWin.style.display = 'flex'
    }

    // Expose DistroAPI and isDev for legacy compatibility
    window.DistroAPI = DistroAPI
    window.isDev = isDev

    // Initialize Distribution API
    try {
        console.log('Renderer Bootstrap Phase 3: Initializing DistroAPI...')
        await DistroAPI.init() // This is DistroManager.init basically
        console.log('DistroAPI initialized.')
    } catch (e) {
        console.error('Failed to initialize DistroAPI:', e)
    }
    
    // Signal readiness
    ipcRenderer.send('renderer-ready')
})
