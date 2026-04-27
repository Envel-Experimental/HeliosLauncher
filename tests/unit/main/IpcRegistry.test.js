// Mock electron first
const listeners = {}
const handlers = {}
jest.mock('electron', () => ({
    app: {
        getVersion: jest.fn().mockReturnValue('1.0.0'),
        getAppPath: jest.fn().mockReturnValue('/app'),
        relaunch: jest.fn(),
        exit: jest.fn(),
        isPackaged: false
    },
    shell: {
        trashItem: jest.fn().mockResolvedValue(true),
        openExternal: jest.fn().mockResolvedValue(true),
        openPath: jest.fn().mockResolvedValue('')
    },
    ipcMain: {
        on: jest.fn((event, cb) => { listeners[event] = cb }),
        handle: jest.fn((event, cb) => { handlers[event] = cb }),
        emit: jest.fn(),
        _listeners: listeners,
        _handlers: handlers
    },
    dialog: {
        showOpenDialog: jest.fn().mockResolvedValue({ canceled: false, filePaths: ['/test'] })
    }
}))

// Mock fs
jest.mock('fs', () => ({
    statSync: jest.fn().mockReturnValue({
        isDirectory: () => false,
        isFile: () => true,
        size: 100,
        mtimeMs: Date.now()
    })
}))

// Mock os
jest.mock('os', () => ({
    totalmem: jest.fn().mockReturnValue(8 * 1024 * 1024 * 1024),
    freemem: jest.fn().mockReturnValue(4 * 1024 * 1024 * 1024),
    cpus: jest.fn().mockReturnValue([{ model: 'Intel', speed: 3000 }]),
    networkInterfaces: jest.fn().mockReturnValue({ eth0: [] }),
    platform: jest.fn().mockReturnValue('win32')
}))

// Mock other dependencies
jest.mock('../../../app/main/WindowManager', () => ({
    getMainWindow: jest.fn().mockReturnValue({
        close: jest.fn(),
        minimize: jest.fn(),
        maximize: jest.fn(),
        unmaximize: jest.fn(),
        isMaximized: jest.fn().mockReturnValue(false),
        setProgressBar: jest.fn(),
        webContents: {
            toggleDevTools: jest.fn(),
            send: jest.fn()
        }
    })
}))

jest.mock('../../../app/main/AutoUpdaterService', () => ({ init: jest.fn() }))
jest.mock('../../../app/main/MicrosoftAuthService', () => ({ init: jest.fn() }))
jest.mock('../../../app/main/LauncherService', () => ({ init: jest.fn() }))
jest.mock('../../../app/main/FsService', () => ({ init: jest.fn() }))
jest.mock('../../../app/main/ModService', () => ({ init: jest.fn() }))
jest.mock('../../../app/main/ServerStatusService', () => ({ init: jest.fn() }))
jest.mock('../../../app/main/SentryService', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }))
jest.mock('../../../app/main/CryptoService', () => ({ init: jest.fn() }), { virtual: true })

jest.mock('../../../app/assets/js/core/LaunchController', () => ({ init: jest.fn() }))

jest.mock('../../../network/MirrorManager', () => ({
    getMirrorStatus: jest.fn().mockReturnValue([{ name: 'test', latency: 50 }]),
    measureAllLatencies: jest.fn().mockResolvedValue()
}), { virtual: true })

jest.mock('../../../network/P2PEngine', () => ({
    getNetworkInfo: jest.fn().mockReturnValue({ connected: true }),
    start: jest.fn().mockResolvedValue()
}), { virtual: true })

jest.mock('../../../network/StatsManager', () => ({
    getFullStats: jest.fn().mockReturnValue({ all: { uploaded: 100, downloaded: 200 } })
}), { virtual: true })

jest.mock('../../../network/config', () => ({
    BOOTSTRAP_NODES: [{ host: '1.2.3.4' }],
    SUPPORT_CONFIG_URL: 'http://support'
}), { virtual: true })

jest.mock('../../../app/assets/js/core/configmanager', () => ({
    isLoaded: jest.fn().mockReturnValue(true),
    load: jest.fn().mockResolvedValue(),
    getConfig: jest.fn().mockReturnValue({}),
    setConfig: jest.fn(),
    save: jest.fn().mockResolvedValue(true),
    getLauncherDirectory: jest.fn().mockResolvedValue('/launcher'),
    getLauncherDirectorySync: jest.fn().mockReturnValue('/launcher'),
    getSupportUrl: jest.fn().mockReturnValue('http://support'),
    getP2PUploadLimit: jest.fn().mockReturnValue(15),
    getClientToken: jest.fn().mockReturnValue('test-id'),
    setClientToken: jest.fn()
}))

const { ipcMain, app, shell } = require('electron')
const IpcRegistry = require('../../../app/main/IpcRegistry')

describe('IpcRegistry', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        IpcRegistry.initialized = false
        IpcRegistry.init()
    })

    describe('General App IPCs', () => {
        it('should return version on app:getVersionSync', () => {
            const event = { returnValue: null }
            listeners['app:getVersionSync'](event)
            expect(event.returnValue).toBe('1.0.0')
        })

        it('should handle renderer-error', () => {
            const SentryService = require('../../../app/main/SentryService')
            listeners['renderer-error']({}, 'test error')
            expect(SentryService.captureException).toHaveBeenCalledWith('test error')
        })

        it('should handle fs:statSync', () => {
            const event = { returnValue: null }
            listeners['fs:statSync'](event, '/test.file')
            expect(event.returnValue).toHaveProperty('size', 100)
        })

        it('should return app:isDev', () => {
            const event = { returnValue: null }
            listeners['app:isDev'](event)
            expect(event.returnValue).toBe(true) // !app.isPackaged (mocked as false)
        })

        it('should return app:getAppPath', () => {
            const event = { returnValue: null }
            listeners['app:getAppPath'](event)
            expect(event.returnValue).toBe('/app')
        })
    })

    describe('Config IPCs', () => {
        it('should handle config:load', async () => {
            const ConfigManager = require('../../../app/assets/js/core/configmanager')
            ConfigManager.isLoaded.mockReturnValueOnce(false)
            const result = await handlers['config:load']()
            expect(ConfigManager.load).toHaveBeenCalled()
            expect(result).toBeDefined()
        })

        test('config:save updates and saves config', async () => {
            const mockData = { a: 1 }
            const ConfigManager = require('../../../app/assets/js/core/configmanager')
            
            await handlers['config:save'](null, mockData)
            
            expect(ConfigManager.setConfig).toHaveBeenCalledWith(mockData)
            expect(ConfigManager.save).toHaveBeenCalled()
        })

        test('window-action handles various actions', () => {
            const WindowManager = require('../../../app/main/WindowManager')
            const win = WindowManager.getMainWindow()
            
            // minimize
            listeners['window-action'](null, 'minimize')
            expect(win.minimize).toHaveBeenCalled()
            
            // maximize
            win.isMaximized.mockReturnValue(false)
            listeners['window-action'](null, 'maximize')
            expect(win.maximize).toHaveBeenCalled()
            
            // unmaximize
            win.isMaximized.mockReturnValue(true)
            listeners['window-action'](null, 'maximize')
            expect(win.unmaximize).toHaveBeenCalled()
            
            // toggleDevTools
            listeners['window-action'](null, 'toggleDevTools')
            expect(win.webContents.toggleDevTools).toHaveBeenCalled()
        })

        test('renderer-ready triggers system checks and distribution signal', async () => {
            // Mock sysutil
            jest.mock('../../../app/assets/js/core/sysutil', () => ({
                performChecks: jest.fn().mockResolvedValue(['warning1'])
            }), { virtual: true })
            
            const mockEvent = {
                sender: { send: jest.fn() }
            }
            
            await listeners['renderer-ready'](mockEvent)
            
            expect(mockEvent.sender.send).toHaveBeenCalledWith('distributionIndexDone', true)
            expect(mockEvent.sender.send).toHaveBeenCalledWith('system-warnings', ['warning1'])
        })

        test('renderer-log and renderer-warn should not crash', () => {
            const spyLog = jest.spyOn(console, 'log').mockImplementation()
            const spyWarn = jest.spyOn(console, 'warn').mockImplementation()
            
            listeners['renderer-log'](null, 'test log')
            listeners['renderer-warn'](null, 'test warn')
            
            expect(spyLog).toHaveBeenCalledWith('[Renderer Log]', 'test log')
            expect(spyWarn).toHaveBeenCalledWith('[Renderer Warning]', 'test warn')
            
            spyLog.mockRestore()
            spyWarn.mockRestore()
        })

        it('should handle launcher:showOpenDialog', async () => {
            const { dialog } = require('electron')
            const result = await handlers['launcher:showOpenDialog']({}, { properties: ['openFile'] })
            expect(dialog.showOpenDialog).toHaveBeenCalled()
            expect(result.filePaths).toContain('/test')
        })
    })

    describe('Shell IPCs', () => {
        it('should handle shell:trashItem', async () => {
            const result = await handlers['shell:trashItem']({}, '/test.file')
            expect(result.result).toBe(true)
        })

        it('should handle app:open-url', () => {
            listeners['app:open-url']({}, 'https://google.com')
            expect(shell.openExternal).toHaveBeenCalledWith('https://google.com')
        })
    })

    describe('Network IPCs', () => {
        it('should handle connectivity:check', async () => {
            global.fetch = jest.fn().mockResolvedValue({ ok: true })
            const result = await handlers['connectivity:check']()
            expect(result.github).toBe(true)
        })

        it('should handle mirrors:fetchHealth', async () => {
            global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 })
            const result = await handlers['mirrors:fetchHealth']({}, 'http://mirror')
            expect(result.ok).toBe(true)
            expect(result.latency).toBeDefined()
        })
    })

    describe('System Bridge', () => {
        it('should return system info via sync call', () => {
            const event = { returnValue: null }
            listeners['system:getSystemInfoSync'](event)
            expect(event.returnValue).toHaveProperty('networkInterfaces')
        })

        it('should handle p2p:getBootstrapStatus', async () => {
            const result = await handlers['p2p:getBootstrapStatus']()
            expect(result).toBeDefined()
        })

        it('should handle system:getSystemInfo', async () => {
            const result = await handlers['system:getSystemInfo']()
            expect(result).toHaveProperty('platform', 'win32')
            expect(result).toHaveProperty('totalmem')
        })

        it('should handle system:cwdSync', () => {
            const event = { returnValue: null }
            listeners['system:cwdSync'](event)
            expect(event.returnValue).toBeDefined()
        })
    })

    describe('Window/UI Actions', () => {
        it('should handle window-action close', () => {
            const WindowManager = require('../../../app/main/WindowManager')
            const win = WindowManager.getMainWindow()
            listeners['window-action']({}, 'close')
            expect(win.close).toHaveBeenCalled()
        })

        it('should handle ui:action crash-support', async () => {
            const { shell } = require('electron')
            await listeners['ui:action']({}, 'crash-support')
            expect(shell.openExternal).toHaveBeenCalledWith('http://support')
        })
    })
})
