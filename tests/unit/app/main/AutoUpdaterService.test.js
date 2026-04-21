jest.mock('electron', () => ({
    ipcMain: {
        on: jest.fn()
    },
    app: {
        getVersion: jest.fn(() => '3.0.0-beta'),
        getAppPath: jest.fn(() => '/mock/app/path')
    }
}))

jest.mock('electron-updater', () => ({
    autoUpdater: {
        checkForUpdates: jest.fn().mockResolvedValue({ updateInfo: { version: '3.0.1' } }),
        setFeedURL: jest.fn(),
        quitAndInstall: jest.fn(),
        on: jest.fn(),
        removeAllListeners: jest.fn(),
        allowPrerelease: false,
        autoInstallOnAppQuit: true
    }
}))

jest.mock('../../../../app/assets/js/core/configmanager', () => ({
    getAllowPrerelease: jest.fn(() => false),
    fetchWithTimeout: jest.fn()
}))

jest.mock('../../../../app/assets/js/core/util/SignatureUtils', () => ({
    verifyDistribution: jest.fn(() => true)
}))

const { ipcMain, app } = require('electron')
const { autoUpdater } = require('electron-updater')
const AutoUpdaterService = require('../../../../app/main/AutoUpdaterService')
const ConfigManager = require('../../../../app/assets/js/core/configmanager')
const { verifyDistribution } = require('../../../../app/assets/js/core/util/SignatureUtils')

describe('AutoUpdaterService', () => {
    let mockEvent

    beforeEach(() => {
        jest.clearAllMocks()
        mockEvent = {
            sender: {
                send: jest.fn(),
                isDestroyed: jest.fn(() => false)
            }
        }
    })

    test('should initialize and register IPC listeners', () => {
        AutoUpdaterService.init()
        expect(ipcMain.on).toHaveBeenCalledWith('autoUpdateAction', expect.any(Function))
    })

    test('checkForUpdate should trigger autoUpdater', async () => {
        AutoUpdaterService.handleAction(mockEvent, 'checkForUpdate')
        
        // Use setImmediate to wait for the promise inside handleAction
        await new Promise(resolve => setImmediate(resolve))
        
        expect(autoUpdater.checkForUpdates).toHaveBeenCalled()
    })

    test('installUpdateNow should call quitAndInstall', () => {
        AutoUpdaterService.handleAction(mockEvent, 'installUpdateNow')
        expect(autoUpdater.quitAndInstall).toHaveBeenCalled()
    })

    test('verifyMetadataSignature should return true for valid signature', async () => {
        ConfigManager.fetchWithTimeout.mockResolvedValueOnce({
            ok: true,
            arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('mock yaml content'))
        })
        ConfigManager.fetchWithTimeout.mockResolvedValueOnce({
            ok: true,
            text: jest.fn().mockResolvedValue('mock-signature-hex')
        })

        const result = await AutoUpdaterService.verifyMetadataSignature('https://f-launcher.ru/fox/new/updates')
        
        expect(result).toBe(true)
        expect(verifyDistribution).toHaveBeenCalled()
    })

    test('verifyMetadataSignature should return false for invalid signature', async () => {
        ConfigManager.fetchWithTimeout.mockResolvedValueOnce({
            ok: true,
            arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('corrupted content'))
        })
        ConfigManager.fetchWithTimeout.mockResolvedValueOnce({
            ok: true,
            text: jest.fn().mockResolvedValue('invalid-sig')
        })
        
        verifyDistribution.mockReturnValueOnce(false)

        const result = await AutoUpdaterService.verifyMetadataSignature('https://f-launcher.ru/fox/new/updates')
        
        expect(result).toBe(false)
    })
})
