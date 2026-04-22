const mockWin = {
    loadFile: jest.fn(),
    loadURL: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    removeMenu: jest.fn(),
    isDestroyed: jest.fn().mockReturnValue(false),
    webContents: {
        session: {
            webRequest: {
                onHeadersReceived: jest.fn()
            }
        },
        on: jest.fn(),
        setWindowOpenHandler: jest.fn()
    }
}

jest.mock('electron', () => ({
    BrowserWindow: jest.fn().mockImplementation(() => mockWin),
    app: {
        getVersion: jest.fn().mockReturnValue('1.0.0'),
        quit: jest.fn(),
        on: jest.fn(),
        getPath: jest.fn().mockReturnValue('/mock/path')
    },
    Menu: {
        buildFromTemplate: jest.fn(),
        setApplicationMenu: jest.fn()
    },
    shell: {
        openExternal: jest.fn()
    },
    ipcMain: {
        handle: jest.fn(),
        on: jest.fn()
    }
}))

// Mock LaunchController as it is required in createMainWindow
jest.mock('../../../app/assets/js/core/LaunchController', () => ({
    setWindow: jest.fn()
}))

const WindowManager = require('../../../app/main/WindowManager')
const { BrowserWindow } = require('electron')

describe('WindowManager', () => {
    
    beforeEach(() => {
        jest.clearAllMocks()
        // Reset singleton state if needed
        WindowManager.win = null
        WindowManager.errorWin = null
    })

    it('should create a main window with the correct dimensions and security settings', () => {
        const win = WindowManager.createMainWindow()
        
        expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
            width: 980,
            height: 552,
            frame: false,
            webPreferences: expect.objectContaining({
                contextIsolation: true,
                sandbox: true
            })
        }))
        
        expect(win.loadFile).toHaveBeenCalled()
        expect(WindowManager.getMainWindow()).toBe(win)
    })

    it('should create a Microsoft Auth window with the given title', () => {
        const authWin = WindowManager.createMicrosoftAuthWindow('Login Test')
        
        expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
            width: 520,
            height: 600,
            title: 'Login Test'
        }))
        expect(authWin.removeMenu).toHaveBeenCalled()
    })

    it('should show a critical error window and hide the main window', () => {
        // First create a main window
        const mainWin = WindowManager.createMainWindow()
        
        const error = new Error('Boom!')
        WindowManager.showCriticalError(error)
        
        expect(mainWin.hide).toHaveBeenCalled()
        expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
            backgroundColor: '#0078d7',
            title: 'Critical Error'
        }))
    })

    it('should return correct platform icon path', () => {
        const iconPath = WindowManager.getPlatformIcon('testicon')
        expect(iconPath).toContain('testicon')
        // Check extension based on platform
        if (process.platform === 'win32') {
            expect(iconPath).toMatch(/\.ico$/)
        } else {
            expect(iconPath).toMatch(/\.png$/)
        }
    })
})
