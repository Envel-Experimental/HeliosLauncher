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

        jest.mock('@network/MirrorManager', () => ({
            getSortedMirrors: jest.fn().mockReturnValue([
                { distribution: 'https://f-launcher.ru/fox/new/distribution.json' },
                { distribution: 'https://mirror.nikita.best/distribution.json' }
            ])
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

        it('should generate fallbackUrls for modules when mirrors are configured', async () => {
            FileUtils.validateLocalFile.mockResolvedValueOnce(false)
            
            const mockModule = {
                getPath: jest.fn().mockReturnValue('mod1.jar'),
                hasSubModules: jest.fn().mockReturnValue(false),
                rawModule: {
                    id: 'mod1',
                    artifact: {
                        url: 'https://f-launcher.ru/fox/new/files/mod1.jar',
                        SHA256: 'sha256-hash',
                        size: 100
                    }
                }
            }
            
            const processor = new DistributionIndexProcessor('/common', {
                getServerById: jest.fn().mockReturnValue({ modules: [mockModule] })
            }, 'server1')
            
            const result = await processor.validateModules([mockModule])
            expect(result).toHaveLength(1)
            expect(result[0].fallbackUrls).toContain('https://mirror.nikita.best/files/mod1.jar')
        })
    })
})
