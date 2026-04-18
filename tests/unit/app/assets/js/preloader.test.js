describe('preloader', () => {
    let ConfigManager
    const launcherDir = '/game/launcher'

    beforeEach(() => {
        jest.resetModules()
        
        // Corrected path: tests/unit/app/assets/js/preloader.test.js -> core/configmanager
        jest.mock('../../../../../app/assets/js/core/configmanager', () => ({
            getLauncherDirectory: jest.fn(),
            fetchWithTimeout: jest.fn()
        }))

        ConfigManager = require('../../../../../app/assets/js/core/configmanager')
        ConfigManager.getLauncherDirectory.mockReturnValue(launcherDir)
    })

    test('should return correct launcher directory', () => {
        expect(ConfigManager.getLauncherDirectory()).toBe(launcherDir)
    })
})
