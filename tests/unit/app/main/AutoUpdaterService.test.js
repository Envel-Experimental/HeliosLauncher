const { EventEmitter } = require('events')

// Mock electron
const mockSender = {
    send: jest.fn(),
    isDestroyed: jest.fn().mockReturnValue(false)
}
const mockEvent = { sender: mockSender }

const ipcListeners = {}
jest.mock('electron', () => ({
    ipcMain: {
        on: jest.fn((event, cb) => { ipcListeners[event] = cb })
    },
    app: {
        getAppPath: jest.fn().mockReturnValue('/app'),
        getVersion: jest.fn().mockReturnValue('1.0.0')
    }
}))

// Mock electron-updater
const mockAutoUpdater = new EventEmitter()
mockAutoUpdater.checkForUpdates = jest.fn().mockResolvedValue({ updateInfo: { version: '1.1.0' } })
mockAutoUpdater.quitAndInstall = jest.fn()
mockAutoUpdater.setFeedURL = jest.fn()
mockAutoUpdater.removeAllListeners = jest.fn()
mockAutoUpdater.allowPrerelease = false
jest.mock('electron-updater', () => ({
    autoUpdater: mockAutoUpdater
}))

// Mock dependencies
jest.mock('../../../../app/assets/js/core/isdev', () => false)
jest.mock('../../../../app/assets/js/core/configmanager', () => ({
    fetchWithTimeout: jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(10)),
        text: jest.fn().mockResolvedValue('mock-signature')
    })
}))
jest.mock('../../../../app/assets/js/core/util/SignatureUtils', () => ({
    verifyDistribution: jest.fn().mockReturnValue(true)
}))

const AutoUpdaterService = require('../../../../app/main/AutoUpdaterService')

describe('AutoUpdaterService', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        AutoUpdaterService.init()
    })

    it('should register autoUpdateAction listener', () => {
        expect(ipcListeners['autoUpdateAction']).toBeDefined()
    })

    describe('handleAction', () => {
        it('should handle initAutoUpdater', () => {
            ipcListeners['autoUpdateAction'](mockEvent, 'initAutoUpdater', true)
            expect(mockSender.send).toHaveBeenCalledWith('autoUpdateNotification', 'ready')
            expect(mockAutoUpdater.allowPrerelease).toBe(true)
        })

        it('should handle checkForUpdate success', async () => {
            await AutoUpdaterService.handleAction(mockEvent, 'checkForUpdate')
            expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalled()
        })

        it('should handle checkForUpdate fallback on failure', async () => {
            mockAutoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('primary fail'))
            
            await AutoUpdaterService.handleAction(mockEvent, 'checkForUpdate')
            
            // Wait for async fallback
            await new Promise(resolve => setImmediate(resolve))
            
            expect(mockAutoUpdater.setFeedURL).toHaveBeenCalled()
            expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
        })

        it('should handle installUpdateNow', () => {
            AutoUpdaterService.handleAction(mockEvent, 'installUpdateNow')
            expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalled()
        })
    })

    describe('sendError', () => {
        it('should send antivirus-issue for EPERM', () => {
            AutoUpdaterService.sendError(mockSender, { code: 'EPERM' })
            expect(mockSender.send).toHaveBeenCalledWith('autoUpdateNotification', 'antivirus-issue')
        })

        it('should send realerror for other errors', () => {
            const err = new Error('boom')
            AutoUpdaterService.sendError(mockSender, err)
            expect(mockSender.send).toHaveBeenCalledWith('autoUpdateNotification', 'realerror', err)
        })
    })

    describe('verifyMetadataSignature', () => {
        it('should return true on valid signature', async () => {
            const result = await AutoUpdaterService.verifyMetadataSignature('http://test')
            expect(result).toBe(true)
        })

        it('should return false on fetch failure', async () => {
            const ConfigManager = require('../../../../app/assets/js/core/configmanager')
            ConfigManager.fetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 404 })
            
            const result = await AutoUpdaterService.verifyMetadataSignature('http://test')
            expect(result).toBe(false)
        })
    })
})
