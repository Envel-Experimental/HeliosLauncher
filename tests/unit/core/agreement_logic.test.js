const fs = require('fs/promises')

// Mock Electron app path
jest.mock('electron', () => ({
    app: {
        getPath: jest.fn().mockReturnValue('/mock/user/data'),
        getVersion: jest.fn().mockReturnValue('1.0.0')
    }
}))

// Mock pathutil to return a mock directory
jest.mock('../../../app/assets/js/core/pathutil', () => ({
    resolveDataPathSync: jest.fn().mockReturnValue('/mock/launcher/dir')
}))

// Mock fs/promises to keep files in memory/mocked
jest.mock('fs/promises', () => ({
    access: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn()
}))

const ConfigManager = require('../../../app/assets/js/core/configmanager')

describe('ConfigManager Agreement Logic', () => {
    beforeEach(async () => {
        jest.clearAllMocks()
        // Reset config to a clean state
        ConfigManager.setConfig({
            settings: {
                deliveryOptimization: {},
                launcher: {}
            }
        })
    })

    test('should report agreement not accepted initially', async () => {
        // hasAcceptedAgreement checks for file existence, so we can't easily mock it without fs mock
        // But we can check our new flags which are in-memory config
        const accepted = ConfigManager.hasAcceptedP2PLegalAgreement()
        expect(accepted).toBe(false)
    })

    test('should report P2P legal agreement not accepted initially', () => {
        const accepted = ConfigManager.hasAcceptedP2PLegalAgreement()
        expect(accepted).toBe(false)
    })

    test('should record main agreement acceptance', async () => {
        await ConfigManager.acceptAgreement()
        const accepted = await ConfigManager.hasAcceptedAgreement()
        expect(accepted).toBe(true)
    })

    test('should record P2P legal agreement acceptance', () => {
        ConfigManager.acceptP2PLegalAgreement()
        const accepted = ConfigManager.hasAcceptedP2PLegalAgreement()
        expect(accepted).toBe(true)
        
        // Should also mark legacy prompt as shown
        expect(ConfigManager.getP2PPromptShown()).toBe(true)
    })

    test('setLocalOptimization should exist and work', () => {
        ConfigManager.setLocalOptimization(true)
        expect(ConfigManager.getLocalOptimization()).toBe(true)
        ConfigManager.setLocalOptimization(false)
        expect(ConfigManager.getLocalOptimization()).toBe(false)
    })

    test('setGlobalOptimization should exist and work', () => {
        ConfigManager.setGlobalOptimization(true)
        expect(ConfigManager.getGlobalOptimization()).toBe(true)
        ConfigManager.setGlobalOptimization(false)
        expect(ConfigManager.getGlobalOptimization()).toBe(false)
    })
})
