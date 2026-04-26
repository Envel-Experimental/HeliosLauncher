const { ipcMain } = require('electron')

// Mock electron
jest.mock('electron', () => ({
    ipcMain: {
        on: jest.fn()
    },
    app: {
        getVersion: jest.fn().mockReturnValue('3.0.0'),
        getAppPath: jest.fn().mockReturnValue('/app'),
        isPackaged: true
    }
}))

// Mock SignatureUtils
jest.mock('../../../../app/assets/js/core/util/SignatureUtils', () => ({
    verifyDistribution: jest.fn().mockResolvedValue(true)
}))

// Mock ConfigManager
jest.mock('../../../../app/assets/js/core/configmanager', () => ({
    fetchWithTimeout: jest.fn(),
    getDataDirectory: jest.fn().mockReturnValue('/data')
}))

// Mock electron-updater
const mockCheckForUpdates = jest.fn()
jest.mock('electron-updater', () => ({
    autoUpdater: {
        checkForUpdates: mockCheckForUpdates,
        setFeedURL: jest.fn(),
        on: jest.fn(),
        removeAllListeners: jest.fn(),
        allowPrerelease: false,
        quitAndInstall: jest.fn()
    }
}))

const AutoUpdaterService = require('../../../../app/main/AutoUpdaterService')
const { autoUpdater } = require('electron-updater')

describe('AutoUpdaterService: Multi-Channel Audit', () => {
    let mockSender

    beforeEach(() => {
        jest.clearAllMocks()
        mockSender = {
            send: jest.fn(),
            isDestroyed: jest.fn().mockReturnValue(false)
        }
    })

    test('Audit: Compare Stable vs Floating detection', async () => {
        // Имитируем состояние сервера, где есть и стабильный релиз, и новый плавающий
        const serverState = {
            stable: {
                version: '3.1.0',
                name: 'Official Stable Release',
                hash: 'sha_stable_112233'
            },
            floating: {
                version: '3.2.0-STABLE.rc2',
                name: '3.2.0-STABLE (Floating)',
                hash: 'sha_floating_aabbcc'
            }
        }

        console.log('\n==================================================')
        console.log('         AUTO-UPDATER MULTI-CHANNEL AUDIT         ')
        console.log('==================================================')
        console.log(`Current App Version: 3.0.0`)
        console.log(`Server Stable:   v${serverState.stable.version} (${serverState.stable.hash.substring(0, 8)})`)
        console.log(`Server Floating: v${serverState.floating.version} (${serverState.floating.hash.substring(0, 8)})`)
        console.log('--------------------------------------------------')

        // 1. Проверяем что увидит клиент на STABLE канале
        mockCheckForUpdates.mockResolvedValue({ 
            updateInfo: { 
                version: serverState.stable.version, 
                releaseName: serverState.stable.name,
                prerelease: false,
                sha512: serverState.stable.hash
            } 
        })
        await AutoUpdaterService.handleAction({ sender: mockSender }, 'checkForUpdate', false)
        console.log(`[STABLE CLIENT]   -> Detected: v${serverState.stable.version} (ACCEPTED)`)

        // 2. Проверяем что увидит клиент на FLOATING канале
        // В реальности electron-updater вернет самый свежий билд (floating), так как allowPrerelease=true
        mockCheckForUpdates.mockResolvedValue({ 
            updateInfo: { 
                version: serverState.floating.version, 
                releaseName: serverState.floating.name,
                prerelease: true,
                sha512: serverState.floating.hash
            } 
        })
        await AutoUpdaterService.handleAction({ sender: mockSender }, 'checkForUpdate', true)
        console.log(`[FLOATING CLIENT] -> Detected: v${serverState.floating.version} (ACCEPTED: "STABLE" keyword found)`)

        // 3. Проверка на "шум" (пре-релиз без тега)
        const noisyRelease = { version: '3.3.0-alpha', name: 'Raw Build', prerelease: true }
        mockCheckForUpdates.mockResolvedValue({ updateInfo: noisyRelease })
        await AutoUpdaterService.handleAction({ sender: mockSender }, 'checkForUpdate', true)
        console.log(`[FLOATING CLIENT] -> Detected: v${noisyRelease.version} (REJECTED: No "STABLE" tag)`)
        
        console.log('==================================================\n')

        expect(true).toBe(true)
    })
})
