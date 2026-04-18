describe('DistributionIndexProcessor', () => {
    let DistributionIndexProcessor
    let FileUtils
    
    beforeEach(() => {
        jest.resetModules()
        
        // p-limit mock for potential legacy code, though we refactored it
        jest.mock('p-limit', () => ({
            __esModule: true,
            default: jest.fn(() => (fn) => fn())
        }))

        jest.mock('../../../../../../../app/assets/js/core/common/FileUtils', () => ({
            validateLocalFile: jest.fn().mockResolvedValue(true)
        }))

        jest.mock('../../../../../../../app/assets/js/core/util/LoggerUtil', () => ({
            LoggerUtil: {
                getLogger: () => ({
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn()
                })
            }
        }))

        DistributionIndexProcessor = require('../../../../../../../app/assets/js/core/dl/DistributionIndexProcessor').DistributionIndexProcessor
        FileUtils = require('../../../../../../../app/assets/js/core/common/FileUtils')
    })

    describe('validateModules', () => {
        it('should validate modules using FileUtils', async () => {
            const mockModule = {
                getPath: jest.fn().mockReturnValue('mod1.jar'),
                hasSubModules: jest.fn().mockReturnValue(false),
                rawModule: {
                    id: 'mod1',
                    artifact: {
                        url: 'url',
                        SHA256: 'sha256-hash',
                        size: 100
                    }
                }
            }
            const processor = new DistributionIndexProcessor('/common', {
                getServerById: jest.fn().mockReturnValue({ modules: [mockModule] })
            }, 'server1')
            
            await processor.validateModules([mockModule])
            expect(FileUtils.validateLocalFile).toHaveBeenCalled()
        })
    })
})
