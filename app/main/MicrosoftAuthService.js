const { ipcMain } = require('electron')
const WindowManager = require('./WindowManager')
const { MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR, AZURE_CLIENT_ID } = require('../assets/js/core/ipcconstants')
const LangLoader = require('../assets/js/core/langloader')

class MicrosoftAuthService {
    constructor() {
        this.msftAuthSuccess = false
        this.msftAuthViewSuccess = null
        this.msftAuthViewOnClose = null
        
        this.msftLogoutSuccess = false
        this.msftLogoutSuccessSent = false
        this.msftLogoutTimeout = null
    }

    init() {
        ipcMain.on(MSFT_OPCODE.OPEN_LOGIN, (ipcEvent, ...args) => {
            this.handleLogin(ipcEvent, args)
        })

        ipcMain.on(MSFT_OPCODE.OPEN_LOGOUT, (ipcEvent, uuid, isLastAccount) => {
            this.handleLogout(ipcEvent, uuid, isLastAccount)
        })
    }

    handleLogin(ipcEvent, args) {
        if (WindowManager.msftAuthWindow) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN, this.msftAuthViewOnClose)
            return
        }

        this.msftAuthSuccess = false
        this.msftAuthViewSuccess = args[0]
        this.msftAuthViewOnClose = args[1]

        const win = WindowManager.createMicrosoftAuthWindow(LangLoader.queryJS('index.microsoftLoginTitle'))

        win.on('close', () => {
            if (!this.msftAuthSuccess) {
                ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, this.msftAuthViewOnClose)
            }
        })

        win.webContents.on('did-navigate', (_, uri) => {
            const REDIRECT_URI_PREFIX = 'https://login.microsoftonline.com/common/oauth2/nativeclient?'
            if (uri.startsWith(REDIRECT_URI_PREFIX)) {
                const url = new URL(uri)
                const queryMap = Object.fromEntries(url.searchParams.entries())

                ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.SUCCESS, queryMap, this.msftAuthViewSuccess)

                this.msftAuthSuccess = true
                win.close()
            }
        })

        win.loadURL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?prompt=select_account&client_id=' + AZURE_CLIENT_ID + '&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient')
    }

    handleLogout(ipcEvent, uuid, isLastAccount) {
        if (WindowManager.msftLogoutWindow) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN)
            return
        }

        this.msftLogoutSuccess = false
        this.msftLogoutSuccessSent = false
        
        const win = WindowManager.createMicrosoftLogoutWindow(LangLoader.queryJS('index.microsoftLogoutTitle'))

        win.on('close', () => {
            if (this.msftLogoutTimeout) {
                clearTimeout(this.msftLogoutTimeout)
                this.msftLogoutTimeout = null
            }
            if (!this.msftLogoutSuccess) {
                ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED)
            } else if (!this.msftLogoutSuccessSent) {
                this.msftLogoutSuccessSent = true
                ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
            }
        })

        win.webContents.on('did-navigate', (_, uri) => {
            if (uri.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/logoutsession')) {
                this.msftLogoutSuccess = true
                this.msftLogoutTimeout = setTimeout(() => {
                    if (!this.msftLogoutSuccessSent) {
                        this.msftLogoutSuccessSent = true
                        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
                    }

                    if (win && !win.isDestroyed()) {
                        win.close()
                    }
                }, 5000)
            }
        })

        win.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout')
    }
}

module.exports = new MicrosoftAuthService()
