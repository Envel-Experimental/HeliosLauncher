describe('DistroManager', () => {
    
    let DistroManager
    let ConfigManager
    let DistributionAPI

    beforeEach(() => {
        jest.resetModules()
        jest.clearAllMocks()
        process.type = 'renderer'

        // Re-require mocks after resetModules
        jest.mock('../../../app/assets/js/core/configmanager', () => ({
            getLauncherDirectory: jest.fn().mockResolvedValue('/mock/launcher'),
            getCommonDirectory: jest.fn().mockResolvedValue('/mock/common'),
            getInstanceDirectory: jest.fn().mockResolvedValue('/mock/instances')
        }))

        class MockDistributionAPI {
            constructor() {}
        }
        MockDistributionAPI.prototype.pullRemote = jest.fn().mockResolvedValue({ data: {}, signatureValid: true })
        MockDistributionAPI.prototype.getDistribution = jest.fn().mockResolvedValue({ test: 'distro' })
        MockDistributionAPI.prototype.refreshDistributionOrFallback = jest.fn()
        MockDistributionAPI.prototype.toggleDevMode = jest.fn()

        jest.mock('../../../app/assets/js/core/common/DistributionAPI', () => ({
            DistributionAPI: MockDistributionAPI
        }))

        jest.mock('../../../network/config', () => ({
            MOJANG_MIRRORS: [],
            DISTRO_PUB_KEYS: []
        }))

        jest.mock('../../../app/assets/js/core/util', () => ({
            retry: jest.fn(async (fn) => await fn())
        }))

        jest.mock('../../../app/assets/js/core/langloader', () => ({
            queryJS: jest.fn().mockReturnValue('mock')
        }))

        DistroManager = require('../../../app/assets/js/core/distromanager')
        ConfigManager = require('../../../app/assets/js/core/configmanager')
        DistributionAPI = require('../../../app/assets/js/core/common/DistributionAPI').DistributionAPI

        // Mock Globals for UI
        const mockElement = () => ({ style: {} })
        global.document = {
            readyState: 'complete',
            getElementById: jest.fn((id) => mockElement()),
            addEventListener: jest.fn()
        }
        global.toggleOverlay = jest.fn()
        global.setOverlayContent = jest.fn()
        global.setOverlayHandler = jest.fn()
        global.setMiddleButtonHandler = jest.fn()
        global.setDismissHandler = jest.fn()
    })

    it('should initialize and return api', async () => {
        const api = await DistroManager.init()
        expect(api).toBeDefined()
    })

    it('should call original pullRemote in interceptor', async () => {
        const api = await DistroManager.init()
        await api.pullRemote()
        expect(DistributionAPI.prototype.pullRemote).toHaveBeenCalled()
    })

    it('should handle signature validation failure in interceptor', async () => {
        const api = await DistroManager.init()
        
        DistributionAPI.prototype.pullRemote.mockResolvedValueOnce({ data: {}, signatureValid: false })
        
        api.pullRemote()
        
        await new Promise(resolve => setTimeout(resolve, 50))
        
        expect(global.toggleOverlay).toHaveBeenCalledWith(true, true)
    })
})
