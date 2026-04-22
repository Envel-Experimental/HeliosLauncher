// Mock Electron
jest.mock('electron', () => ({
    ipcMain: {
        on: jest.fn(),
        handle: jest.fn()
    }
}))

// Mock WindowManager
jest.mock('../../../app/main/WindowManager', () => ({
    createMicrosoftAuthWindow: jest.fn(),
    createMicrosoftLogoutWindow: jest.fn(),
    msftAuthWindow: null,
    msftLogoutWindow: null
}))

// Mock LangLoader
jest.mock('../../../app/assets/js/core/langloader', () => ({
    queryJS: jest.fn().mockReturnValue('Mock Title')
}))

const MicrosoftAuthService = require('../../../app/main/MicrosoftAuthService')
const { MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR } = require('../../../app/assets/js/core/ipcconstants')
const { ipcMain } = require('electron')
const WindowManager = require('../../../app/main/WindowManager')

describe('MicrosoftAuthService', () => {
    
    beforeEach(() => {
        jest.clearAllMocks()
        MicrosoftAuthService.init()
        WindowManager.msftAuthWindow = null
        WindowManager.msftLogoutWindow = null
    })

    const getHandler = (channel) => {
        const call = ipcMain.on.mock.calls.find(c => c[0] === channel)
        return call ? call[1] : null
    }

    it('should capture auth code from navigation', () => {
        const handler = getHandler(MSFT_OPCODE.OPEN_LOGIN)
        let navigateHandler
        const mockWin = {
            on: jest.fn(),
            webContents: { 
                on: (event, cb) => { if (event === 'did-navigate') navigateHandler = cb } 
            },
            loadURL: jest.fn(),
            close: jest.fn()
        }
        WindowManager.createMicrosoftAuthWindow.mockReturnValue(mockWin)
        
        const ipcEvent = { reply: jest.fn() }
        handler(ipcEvent, 'successView', 'closeView')

        navigateHandler({}, 'https://login.microsoftonline.com/common/oauth2/nativeclient?code=abc123')

        expect(ipcEvent.reply).toHaveBeenCalledWith(
            MSFT_OPCODE.REPLY_LOGIN, 
            MSFT_REPLY_TYPE.SUCCESS, 
            { code: 'abc123' }, 
            'successView'
        )
        expect(mockWin.close).toHaveBeenCalled()
    })

    it('should handle login already open', () => {
        const handler = getHandler(MSFT_OPCODE.OPEN_LOGIN)
        WindowManager.msftAuthWindow = {}
        const ipcEvent = { reply: jest.fn() }
        handler(ipcEvent, 's', 'c')
        expect(ipcEvent.reply).toHaveBeenCalledWith(
            MSFT_OPCODE.REPLY_LOGIN, 
            MSFT_REPLY_TYPE.ERROR, 
            MSFT_ERROR.ALREADY_OPEN, 
            expect.anything()
        )
    })

    it('should handle logout flow', () => {
        const handler = getHandler(MSFT_OPCODE.OPEN_LOGOUT)
        let navigateHandler
        let closeHandler
        const mockWin = {
            on: (event, cb) => { if (event === 'close') closeHandler = cb },
            webContents: { 
                on: (event, cb) => { if (event === 'did-navigate') navigateHandler = cb } 
            },
            loadURL: jest.fn(),
            close: jest.fn(),
            isDestroyed: () => false
        }
        WindowManager.createMicrosoftLogoutWindow.mockReturnValue(mockWin)
        
        const ipcEvent = { reply: jest.fn() }
        handler(ipcEvent, 'uuid-123', true)

        // Simulate navigation to logout session
        navigateHandler({}, 'https://login.microsoftonline.com/common/oauth2/v2.0/logoutsession')
        
        // Simulate close
        closeHandler()

        expect(ipcEvent.reply).toHaveBeenCalledWith(
            MSFT_OPCODE.REPLY_LOGOUT, 
            MSFT_REPLY_TYPE.SUCCESS, 
            'uuid-123', 
            true
        )
    })
});
