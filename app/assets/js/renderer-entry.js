console.log('[Renderer] Bundle execution STARTED');
/**
 * Renderer entry point for bundling
 * Using require() instead of import to ensure strict execution order.
 * Structure: [Stage Zero] -> [Core] -> [UI Core] -> [UI Views] -> [Signal]
 */

// 1. STAGE ZERO: Global polyfills
console.log('[Renderer] Stage Zero: Polyfills')
window.global = window


// Platform Detection (Immediate stabilization)
const platform = (window.HeliosAPI && window.HeliosAPI.system) ? window.HeliosAPI.system.getPlatform() : 'win32'
window.isDev = (window.HeliosAPI && window.HeliosAPI.app) ? window.HeliosAPI.app.isDev() : false
document.body.setAttribute('data-platform', platform)


// 1.1 Polyfill process immediately (Essential for libraries and env detection)
if (typeof process === 'undefined') {
    window.process = {
        platform,
        type: 'renderer',
        env: { HELIOS_DEV_MODE: window.isDev },
        nextTick: (fn) => setTimeout(fn, 0)
    }
} else {
    if (!process.platform) process.platform = platform
    if (process.env) process.env.HELIOS_DEV_MODE = window.isDev
    // Set process type if not defined (handled by esbuild define normally)
    const isRenderer = true
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
console.log('[Renderer] Stage Two: UI Core')
const uicore = require('./ui/uicore.js')
const uibinder = require('./ui/uibinder.js')

// 4. STAGE THREE: UI View Modules
console.log('[Renderer] Stage Three: UI Views')
const landing = require('./ui/views/landing.js')
const settings = require('./ui/views/settings.js')
const welcome = require('./ui/views/welcome.js')
const login = require('./ui/views/login.js')
const loginOptions = require('./ui/views/loginOptions.js')
const overlay = require('./ui/views/overlay.js')

// 5. STAGE FOUR: Global Export Merge
console.log('[Renderer] Stage Four: Merging Exports')
Object.assign(window, uicore)
Object.assign(window, uibinder)
Object.assign(window, landing)
Object.assign(window, loginOptions)
Object.assign(window, overlay)
Object.assign(window, settings)
Object.assign(window, welcome)
Object.assign(window, login)

// 6. STAGE FIVE: Manual Wrapper Linkage
console.log('[Renderer] Stage Five: Wrapper Linkage')
window.setOverlayContent = overlay.setOverlayContent
window.toggleOverlay = overlay.toggleOverlay
window.setOverlayHandler = overlay.setOverlayHandler
window.setMiddleButtonHandler = overlay.setMiddleButtonHandler
window.setDismissHandler = overlay.setDismissHandler


// Initialize frame early so close button works
const frameDarwin = document.getElementById('frameContentDarwin')
const frameWin = document.getElementById('frameContentWin')
if (platform === 'darwin') {
    if (frameDarwin) frameDarwin.style.display = 'flex'
    if (frameWin) frameWin.style.display = 'none'
} else {
    if (frameDarwin) frameDarwin.style.display = 'none'
    if (frameWin) frameWin.style.display = 'flex'
}
console.log('[Renderer] Window frame enabled early (Platform: ' + platform + ')')

// Initialize Languages immediately before config load
try {
    console.log('[Renderer] Setting up language engine...')
    Lang.setupLanguage()
    if (window.setLoadingStatus) {
        window.setLoadingStatus('js.uibinder.loading.loadingConfig')
    }
} catch (e) {
    console.error('[Renderer] Failed to initialize language engine:', e)
}

console.log('[Renderer] Starting ConfigManager load...')
ConfigManager.load().then(async () => {
    console.log('[Renderer] ConfigManager load complete.')

    // Polyfill EJS functionality
    try {
        i18n.applyTranslations()
    } catch (e) {
        console.warn('[Renderer] Failed to apply initial translations:', e)
    }

    document.body.setAttribute('data-platform', platform)

    // Expose DistroAPI and isDev for legacy compatibility
    window.DistroAPI = DistroAPI
    window.isDev = window.isDev || false

    // Initialize Distribution API with Safety Timeout
    try {
        console.log('[Renderer] Initializing DistroAPI...')
        if (window.setLoadingStatus) {
            window.setLoadingStatus('js.uibinder.loading.loadingDistribution')
        }

        const distroPromise = DistroAPI.init()
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('DistroAPI initialization timed out (15s)')), 15000)
        )

        await Promise.race([distroPromise, timeoutPromise])
        console.log('[Renderer] DistroAPI initialized.')

    } catch (e) {
        console.error('[Renderer] Failed to initialize DistroAPI:', e)
        if (window.setLoadingStatus) {
            window.setLoadingStatus('Ошибка: ' + e.message)
        }
    }

    // Signal readiness
    console.log('[Renderer] Sending renderer-ready signal.')
    ipcRenderer.send('renderer-ready')
    
    window._startupFinished = true
    // Create marker for failsafe
    const marker = document.createElement('div')
    marker.id = 'uiBinderInitMarker'
    marker.style.display = 'none'
    document.body.appendChild(marker)
})
