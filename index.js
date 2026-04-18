console.log('[Main] Application entry point reached (index.js)')
const { app, protocol, session, powerMonitor } = require('electron')
const WindowManager = require('./app/main/WindowManager')
const IpcRegistry = require('./app/main/IpcRegistry')
const ConfigManager = require('./app/assets/js/core/configmanager')
const LangLoader = require('./app/assets/js/core/langloader')
const MirrorManager = require('./network/MirrorManager')
const P2PEngine = require('./network/P2PEngine')
const RaceManager = require('./network/RaceManager')
const { MOJANG_MIRRORS } = require('./network/config')

// Single Instance Lock
if (!app.requestSingleInstanceLock()) {
    app.quit()
} else {
    app.on('second-instance', () => {
        const win = WindowManager.getMainWindow()
        if (win) {
            if (win.isMinimized()) win.restore()
            win.focus()
        }
    })
}

// Global Error Handlers
process.on('uncaughtException', (err) => {
    console.error('Critical Uncaught Exception:', err)
    WindowManager.showCriticalError(err)
})

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason)
})

app.on('ready', async () => {
    console.log('[Main] App is ready')
    
    try {
        // 1. Initialize IPC FIRST (to prevent deadlocks)
        IpcRegistry.init()
        console.log('[Main] IPC Registry initialized.')

        // 2. Setup Language
        LangLoader.setupLanguage()
        console.log('[Main] Language setup complete')
        
        console.log('[Main] Registering protocol handlers...')

        // 3. Register Protocols
        protocol.handle('mc-asset', (req) => RaceManager.handle(req))

        // 4. Load Config
        console.log('[Main] Loading configuration...')
        await ConfigManager.load()
        console.log('[Main] Configuration loaded.')

        console.log('[Main] Initializing UI...')
        WindowManager.setupMenu()
        WindowManager.createMainWindow()
        console.log('[Main] UI Window created.')

        console.log('[Main] Starting network services...')
        MirrorManager.init(MOJANG_MIRRORS)
        P2PEngine.start()
        console.log('[Main] Network services initialized.')

        // 6. Content Security Policy & Redirects
        session.defaultSession.webRequest.onBeforeRequest(
            { urls: ['*://resources.download.minecraft.net/*', '*://libraries.minecraft.net/*'] },
            (details, callback) => {
                callback({ redirectURL: 'mc-asset://' + details.url.replace(/^https?:\/\//, '') })
            }
        )

        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            if (details.url.startsWith('file://') || details.url.startsWith('devtools://')) {
                callback({
                    responseHeaders: {
                        ...details.responseHeaders,
                        'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self' *; object-src 'none'; media-src 'self' https:; worker-src 'self'; frame-ancestors 'none'; form-action 'self';"]
                    }
                })
            } else {
                callback({ responseHeaders: details.responseHeaders })
            }
        })

        // Show Window
        const win = WindowManager.getMainWindow()
        if (win) {
            win.once('ready-to-show', () => {
                win.show()
            })
        }
    } catch (err) {
        console.error('[Main] CRITICAL ERROR DURING STARTUP:', err)
        WindowManager.showCriticalError(err)
    }
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
    if (WindowManager.getMainWindow() === null) WindowManager.createMainWindow()
})