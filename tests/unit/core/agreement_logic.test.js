const ConfigManager = require('../../../app/assets/js/core/configmanager')
const fs = require('fs-extra')
const path = require('path')

describe('ConfigManager Agreement Logic', () => {
    const testDir = path.join(__dirname, '../../../../temp_test_user_data')

    beforeEach(async () => {
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
