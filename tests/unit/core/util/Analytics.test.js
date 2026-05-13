// 1. Mocks must be at the very top (before any requires)
jest.mock('../../../../app/assets/js/core/configmanager')
jest.mock('../../../../app/assets/js/core/util/SentryWrapper', () => ({
    SafeSentry: {
        captureException: jest.fn(),
        captureMessage: jest.fn()
    }
}))

process.type = 'renderer'

const Analytics = require('../../../../app/assets/js/core/util/Analytics')
const ConfigManager = require('../../../../app/assets/js/core/configmanager')
const { SafeSentry } = require('../../../../app/assets/js/core/util/SentryWrapper')
const { ipcRenderer } = require('electron')

// Mock sendSync if not already mocked by jest.setup.js
if (!ipcRenderer.sendSync) {
    ipcRenderer.sendSync = jest.fn()
} else if (!ipcRenderer.sendSync.mockImplementation) {
    ipcRenderer.sendSync = jest.fn()
}

describe('Analytics', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        Analytics.enabled = true
        Analytics.distinctId = 'test-id'
        
        // Mock global window
        global.window = {
            screen: { width: 1920, height: 1080 },
            devicePixelRatio: 1,
            isDev: false
        }

        // Setup default mock returns
        ConfigManager.getClientToken.mockReturnValue('test-id')
        ConfigManager.getJavaConfig.mockReturnValue({ minRAM: '1G', maxRAM: '3G' })
        ConfigManager.getP2PUploadEnabled.mockReturnValue(false)
        ConfigManager.getP2PUploadLimit.mockReturnValue(5)
        ConfigManager.getLastLauncherVersion.mockReturnValue('1.0.0')
    })

    test('captureException should call SafeSentry.captureException', async () => {
        const testError = new Error('Disk full')
        
        await Analytics.captureException(testError)

        expect(SafeSentry.captureException).toHaveBeenCalledWith(testError)
    })

    test('init should update HWID and version but NOT capture "Launcher Loaded" (PostHog removed)', async () => {
        ConfigManager.getClientToken.mockReturnValue('existing-token')
        
        ipcRenderer.sendSync.mockImplementation((channel) => {
            if (channel === 'system:getSystemInfoSync') {
                return {
                    platform: 'win32',
                    arch: 'x64',
                    cpus: [{ model: 'Test CPU' }],
                    totalmem: 16 * 1024 * 1024 * 1024,
                    freemem: 8 * 1024 * 1024 * 1024
                }
            }
            if (channel === 'app:getVersionSync') return '1.1.0'
            return null
        })

        await Analytics.init()

        expect(Analytics.distinctId).toBe('existing-token')
        // No Sentry message for loading anymore
        expect(SafeSentry.captureMessage).not.toHaveBeenCalled()
    })

    test('capture should be a no-op (PostHog removed)', async () => {
        await Analytics.capture('Test Event', { prop: 'val' })
        expect(SafeSentry.captureMessage).not.toHaveBeenCalled()
    })
})
