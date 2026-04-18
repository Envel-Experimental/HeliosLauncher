describe('DistroManager', () => {
    let DistroManager
    let ConfigManager
    let DistributionAPI

    beforeEach(() => {
        jest.resetModules()
        
        // Mock window for Renderer-specific logic
        global.window = {}
        
        // Mock core/configmanager
        jest.mock('../../../../../app/assets/js/core/configmanager', () => ({
            getLauncherDirectory: jest.fn().mockResolvedValue('/mock/launcher'),
            getCommonDirectory: jest.fn().mockResolvedValue('/mock/common'),
            getInstanceDirectory: jest.fn().mockResolvedValue('/mock/instance'),
            getLauncherDirectorySync: jest.fn().mockReturnValue('/mock/launcher'),
            getCommonDirectorySync: jest.fn().mockReturnValue('/mock/common'),
            getInstanceDirectorySync: jest.fn().mockReturnValue('/mock/instance'),
            save: jest.fn()
        }))

        // Mock common/DistributionAPI
        // Export should be an object with DistributionAPI key
        jest.mock('../../../../../app/assets/js/core/common/DistributionAPI', () => ({
            DistributionAPI: jest.fn().mockImplementation(() => ({
                init: jest.fn().mockResolvedValue(),
                getServers: jest.fn().mockReturnValue([])
            }))
        }))

        // Mock core/util (LoggerUtil)
        jest.mock('../../../../../app/assets/js/core/util', () => ({
            LoggerUtil: {
                getLogger: jest.fn(() => ({
                    info: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn()
                }))
            }
        }))

        DistroManager = require('../../../../../app/assets/js/core/distromanager')
        ConfigManager = require('../../../../../app/assets/js/core/configmanager')
        DistributionAPI = require('../../../../../app/assets/js/core/common/DistributionAPI').DistributionAPI
    })

    afterEach(() => {
        delete global.window
    })

    it('should initialize successfully', async () => {
        const api = await DistroManager.init()
        expect(ConfigManager.getLauncherDirectory).toHaveBeenCalled()
        // api.init is not called in DistroManager.init() anymore, it is called in some other places
        expect(api).toBeDefined()
        expect(global.window.DistroAPI).toBeDefined()
    })
})
