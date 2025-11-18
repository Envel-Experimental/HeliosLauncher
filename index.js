const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

// Requirements
const { app, BrowserWindow, ipcMain, Menu, shell, powerMonitor, dialog } = require('electron')
const autoUpdater                       = require('electron-updater').autoUpdater
const { spawn }                         = require('child_process')
const ejse                              = require('ejs-electron')
const fs                                = require('fs')
const os                                = require('os')
const isDev                             = require('./app/assets/js/isdev')
const path                              = require('path')
const semver                            = require('semver')
const { pathToFileURL }                 = require('url')
const { AZURE_CLIENT_ID, MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR, SHELL_OPCODE } = require('./app/assets/js/ipcconstants')
const LangLoader                        = require('./app/assets/js/langloader')
const SysUtil                           = require('./app/assets/js/sysutil')
const ConfigManager                     = require('./app/assets/js/configmanager')

// Set up single instance lock.
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
    app.quit()
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (win) {
            if (win.isMinimized()) win.restore()
            win.focus()
        }
    })
}


// Setup Lang
LangLoader.setupLanguage()

process.on('uncaughtException', (err) => {
    if (err.code === 'EPERM') {
        handleEPERM()
    } else {
        console.error('An uncaught exception occurred:', err)
        dialog.showMessageBoxSync({
            type: 'error',
            title: 'Критическая ошибка',
            message: 'Произошла непредвиденная ошибка.',
            detail: err.message,
            buttons: ['Выйти']
        })
        app.quit()
    }
})

process.on('unhandledRejection', (reason, promise) => {
    if (reason && reason.code === 'EPERM') {
        handleEPERM()
    } else {
        console.error('An unhandled rejection occurred:', reason)
        dialog.showMessageBoxSync({
            type: 'error',
            title: 'Критическая ошибка (async)',
            message: 'Произошла непредвиденная асинхронная ошибка.',
            detail: (reason && reason.message) ? reason.message : 'Неизвестная ошибка',
            buttons: ['Выйти']
        })
        app.quit()
    }
})

try {
    const Sentry = require('@sentry/electron/main')
    Sentry.init({
        dsn: 'https://f02442d2a0733ac2c810b8d8d7f4a21e@o4508545424359424.ingest.de.sentry.io/4508545432027216',
    })
} catch (error) {
    console.error('Sentry failed to initialize:', error)
}


// Setup auto updater.
let autoUpdateListeners = {}

function initAutoUpdater(event, data) {

    if(data){
        autoUpdater.allowPrerelease = true
    } else {
        // Defaults to true if application version contains prerelease components (e.g. 0.12.1-alpha.1)
        // autoUpdater.allowPrerelease = true
    }
    
    if(isDev){
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml')
    }
    if(process.platform === 'darwin'){
        autoUpdater.autoDownload = false
    }

    // Event listeners for auto updater.
    const updateAvailableListener = info => {
        if (!event.sender.isDestroyed()) {
            event.sender.send('autoUpdateNotification', 'update-available', info)
        }
    }
    const updateDownloadedListener = info => {
        if (!event.sender.isDestroyed()) {
            event.sender.send('autoUpdateNotification', 'update-downloaded', info)
        }
    }
    const updateNotAvailableListener = info => {
        if (!event.sender.isDestroyed()) {
            event.sender.send('autoUpdateNotification', 'update-not-available', info)
        }
    }
    const checkingForUpdateListener = () => {
        if (!event.sender.isDestroyed()) {
            event.sender.send('autoUpdateNotification', 'checking-for-update')
        }
    }
    const errorListener = err => {
        if (!event.sender.isDestroyed()) {
            if (err.code === 'EPERM' || err.code === 'ENOENT') {
                event.sender.send('autoUpdateNotification', 'antivirus-issue')
            } else {
                event.sender.send('autoUpdateNotification', 'realerror', err)
            }
        }
    }

    // Remove old listeners to prevent memory leaks.
    autoUpdater.removeAllListeners('update-available')
    autoUpdater.removeAllListeners('update-downloaded')
    autoUpdater.removeAllListeners('update-not-available')
    autoUpdater.removeAllListeners('checking-for-update')
    autoUpdater.removeAllListeners('error')

    // Add new listeners.
    autoUpdater.on('update-available', updateAvailableListener)
    autoUpdater.on('update-downloaded', updateDownloadedListener)
    autoUpdater.on('update-not-available', updateNotAvailableListener)
    autoUpdater.on('checking-for-update', checkingForUpdateListener)
    autoUpdater.on('error', errorListener)
}

// Open channel to listen for update actions.
ipcMain.on('autoUpdateAction', (event, arg, data) => {
    if (!event.sender.isDestroyed()) {
        switch(arg){
            case 'initAutoUpdater':
                console.log('Initializing auto updater.')
                initAutoUpdater(event, data)
                event.sender.send('autoUpdateNotification', 'ready')
                break
            case 'checkForUpdate':
                autoUpdater.checkForUpdates()
                    .catch(err => {
                        if (!event.sender.isDestroyed()) {
                            if (err.code === 'EPERM' || err.code === 'ENOENT') {
                                event.sender.send('autoUpdateNotification', 'antivirus-issue')
                            } else {
                                event.sender.send('autoUpdateNotification', 'realerror', err)
                            }
                        }
                    })
                break
            case 'allowPrereleaseChange':
                if(!data){
                    const preRelComp = semver.prerelease(app.getVersion())
                    if(preRelComp != null && preRelComp.length > 0){
                        autoUpdater.allowPrerelease = true
                    } else {
                        autoUpdater.allowPrerelease = data
                    }
                } else {
                    autoUpdater.allowPrerelease = data
                }
                break
            case 'installUpdateNow':
                autoUpdater.quitAndInstall()
                break
            default:
                console.log('Unknown argument', arg)
                break
        }
    }
})
// Redirect distribution index event from preloader to renderer.
ipcMain.on('distributionIndexDone', (event, res) => {
    if (!event.sender.isDestroyed()) {
        event.sender.send('distributionIndexDone', res)
    }
})

// Handle trash item.
ipcMain.handle(SHELL_OPCODE.TRASH_ITEM, async (event, ...args) => {
    try {
        await shell.trashItem(args[0])
        return {
            result: true
        }
    } catch(error) {
        return {
            result: false,
            error: error
        }
    }
})

// Disable hardware acceleration.
// https://electronjs.org/docs/tutorial/offscreen-rendering
app.disableHardwareAcceleration()


const REDIRECT_URI_PREFIX = 'https://login.microsoftonline.com/common/oauth2/nativeclient?'

// Microsoft Auth Login
let msftAuthWindow
let msftAuthSuccess
let msftAuthViewSuccess
let msftAuthViewOnClose
ipcMain.on(MSFT_OPCODE.OPEN_LOGIN, (ipcEvent, ...arguments_) => {
    if (msftAuthWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN, msftAuthViewOnClose)
        return
    }
    msftAuthSuccess = false
    msftAuthViewSuccess = arguments_[0]
    msftAuthViewOnClose = arguments_[1]
    msftAuthWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLoginTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('icon')
    })

    msftAuthWindow.on('closed', () => {
        msftAuthWindow = undefined
    })

    msftAuthWindow.on('close', () => {
        if(!msftAuthSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, msftAuthViewOnClose)
        }
    })

    msftAuthWindow.webContents.on('did-navigate', (_, uri) => {
        if (uri.startsWith(REDIRECT_URI_PREFIX)) {
            let queries = uri.substring(REDIRECT_URI_PREFIX.length).split('#', 1).toString().split('&')
            let queryMap = {}

            queries.forEach(query => {
                const [name, value] = query.split('=')
                queryMap[name] = decodeURI(value)
            })

            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.SUCCESS, queryMap, msftAuthViewSuccess)

            msftAuthSuccess = true
            msftAuthWindow.close()
            msftAuthWindow = null
        }
    })

    msftAuthWindow.removeMenu()
    msftAuthWindow.loadURL(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?prompt=select_account&client_id=${AZURE_CLIENT_ID}&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient`)
})

// Microsoft Auth Logout
let msftLogoutWindow
let msftLogoutSuccess
let msftLogoutSuccessSent
let msftLogoutTimeout
ipcMain.on(MSFT_OPCODE.OPEN_LOGOUT, (ipcEvent, uuid, isLastAccount) => {
    if (msftLogoutWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN)
        return
    }

    msftLogoutSuccess = false
    msftLogoutSuccessSent = false
    msftLogoutWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLogoutTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('icon')
    })

    msftLogoutWindow.on('closed', () => {
        if (msftLogoutTimeout) {
            clearTimeout(msftLogoutTimeout)
            msftLogoutTimeout = null
        }
        msftLogoutWindow = undefined
    })

    msftLogoutWindow.on('close', () => {
        if (msftLogoutTimeout) {
            clearTimeout(msftLogoutTimeout)
            msftLogoutTimeout = null
        }
        if(!msftLogoutSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED)
        } else if(!msftLogoutSuccessSent) {
            msftLogoutSuccessSent = true
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
        }
    })
    
    msftLogoutWindow.webContents.on('did-navigate', (_, uri) => {
        if(uri.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/logoutsession')) {
            msftLogoutSuccess = true
            msftLogoutTimeout = setTimeout(() => {
                if(!msftLogoutSuccessSent) {
                    msftLogoutSuccessSent = true
                    ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
                }

                if(msftLogoutWindow) {
                    msftLogoutWindow.close()
                    msftLogoutWindow = null
                }
            }, 5000)
        }
    })
    
    msftLogoutWindow.removeMenu()
    msftLogoutWindow.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout')
})

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

function createWindow() {

    win = new BrowserWindow({
        width: 980,
        height: 552,
        icon: getPlatformIcon('icon'),
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: '#171614'
    })
    remoteMain.enable(win.webContents)

    const data = {
        bkid: Math.floor((Math.random() * fs.readdirSync(path.join(__dirname, 'app', 'assets', 'images', 'backgrounds')).length)),
        lang: (str, placeHolders) => LangLoader.queryEJS(str, placeHolders)
    }
    Object.entries(data).forEach(([key, val]) => ejse.data(key, val))

    win.loadURL(pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString())

    win.once('ready-to-show', async () => {
        const warnings = await SysUtil.performChecks()
        if (win && !win.isDestroyed()) {
            
            try {
                if (!ConfigManager.getTotalRAMWarningShown()) {
                    const totalRam = os.totalmem() / (1024 * 1024 * 1024)
                    if (totalRam < 6) {
                        warnings.push('lowTotalRAM')
                        ConfigManager.setTotalRAMWarningShown(true)
                        await ConfigManager.save()
                    }
                }
            } catch (err) {
                if (err.code === 'EPERM') {
                    handleEPERM()
                    return
                } else {
                    console.error('Failed to save config during ready-to-show:', err)
                }
            }

            if (warnings.length > 0) {
                win.webContents.send('system-warnings', warnings)
            }
            win.show()
        }
    })

    win.removeMenu()

    win.resizable = true

    win.on('closed', () => {
        win = null
    })
}

function createMenu() {
    
    if(process.platform === 'darwin') {

        // Extend default included application menu to continue support for quit keyboard shortcut
        let applicationSubMenu = {
            label: 'Application',
            submenu: [{
                label: 'About Application',
                selector: 'orderFrontStandardAboutPanel:'
            }, {
                type: 'separator'
            }, {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: () => {
                    app.quit()
                }
            }]
        }

        // New edit menu adds support for text-editing keyboard shortcuts
        let editSubMenu = {
            label: 'Edit',
            submenu: [{
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }]
        }

        // Bundle submenus into a single template and build a menu object with it
        let menuTemplate = [applicationSubMenu, editSubMenu]
        let menuObject = Menu.buildFromTemplate(menuTemplate)

        // Assign it to the application
        Menu.setApplicationMenu(menuObject)

    }

}

function getPlatformIcon(filename){
    let ext
    switch(process.platform) {
        case 'win32':
            ext = 'ico'
            break
        case 'darwin':
        case 'linux':
        default:
            ext = 'png'
            break
    }

    return path.join(__dirname, 'app', 'assets', 'images', `${filename}.${ext}`)
}

function relaunchAsAdmin() {
    if (process.platform === 'win32') {
        
        const command = `Start-Process -FilePath "${process.execPath}" -Verb RunAs`
        
        const ps = spawn('powershell.exe', ['-Command', command], {
            detached: true,
            stdio: 'ignore'
        })

        ps.unref()

        setTimeout(() => {
            app.quit()
        }, 3000)

    } else {
        dialog.showMessageBoxSync({
            type: 'error',
            title: 'Ошибка прав доступа',
            message: 'Для продолжения работы требуются права администратора.',
            detail: 'Перезапустите приложение от имени администратора.',
            buttons: ['Выйти']
        })
        app.quit()
    }
}

function handleEPERM() {
    const choice = dialog.showMessageBoxSync({
        type: 'error',
        title: 'Ошибка прав доступа',
        message: 'Нужны права администратора, чтобы продолжить.',
        detail: 'Никак не получается создать файл.\n\nПерезапустить приложение с правами администратора?',
        buttons: ['Перезапустить', 'Выйти'],
        defaultId: 0,
        cancelId: 1
    })
    if (choice === 0) {
        relaunchAsAdmin()
    } else {
        app.quit()
    }
}

app.on('ready', async () => {
    try {
        await ConfigManager.load()
    } catch (err) {
        if (err.code === 'EPERM') {
            handleEPERM()
            return
        }
        console.error('Error loading config:', err)
    }
    createWindow()
    createMenu()
    powerMonitor.on('resume', () => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('power-resume')
        }
    })
})

app.on('before-quit', () => {
    powerMonitor.removeAllListeners('resume')
})


app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow()
    }
})