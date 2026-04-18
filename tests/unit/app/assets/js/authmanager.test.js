describe('AuthManager', () => {
    let AuthManager
    let ConfigManager

    beforeEach(() => {
        jest.resetModules()
        
        // Mock core/configmanager
        jest.mock('../../../../../app/assets/js/core/configmanager', () => ({
            addMojangAuthAccount: jest.fn(),
            removeAuthAccount: jest.fn(),
            save: jest.fn()
        }))

        // Mock LoggerUtil
        jest.mock('../../../../../app/assets/js/core/util/LoggerUtil', () => ({
            LoggerUtil: {
                getLogger: jest.fn(() => ({
                    info: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn()
                }))
            }
        }))

        // Mock MicrosoftAuth
        jest.mock('../../../../../app/assets/js/core/microsoft/MicrosoftAuth', () => ({
            MicrosoftAuth: {}
        }))

        // Mock langloader
        jest.mock('../../../../../app/assets/js/core/langloader', () => ({
            queryJS: jest.fn()
        }))

        // Mock util (for retry)
        jest.mock('../../../../../app/assets/js/core/util', () => ({
            retry: jest.fn()
        }))

        AuthManager = require('../../../../../app/assets/js/core/authmanager')
        ConfigManager = require('../../../../../app/assets/js/core/configmanager')
    })

    it('should add a Mojang account', async () => {
        await AuthManager.addMojangAccount('testuser', 'testpass')
        expect(ConfigManager.addMojangAuthAccount).toHaveBeenCalled()
        expect(ConfigManager.save).toHaveBeenCalled()
    })

    it('should remove a Mojang account', async () => {
        await AuthManager.removeMojangAccount('test-uuid')
        expect(ConfigManager.removeAuthAccount).toHaveBeenCalledWith('test-uuid')
        expect(ConfigManager.save).toHaveBeenCalled()
    })
})
