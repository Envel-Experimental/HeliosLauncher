const { DistributionIndexProcessor } = require('@app/assets/js/core/dl/DistributionIndexProcessor')
const FileUtils = require('@app/assets/js/core/common/FileUtils')
const { HashAlgo } = require('@app/assets/js/core/dl/Asset')

jest.mock('@app/assets/js/core/common/FileUtils')
jest.mock('p-limit', () => ({
    __esModule: true,
    default: jest.fn(() => (fn) => fn())
}))

jest.mock('@app/assets/js/core/util/LoggerUtil', () => ({
    LoggerUtil: {
        getLogger: jest.fn(() => ({
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        }))
    }
}))

describe('DistributionIndexProcessor', () => {
    describe('validateModules', () => {
        let processor
        let mockModule1, mockModule2
        let mockDistribution

        beforeEach(() => {
            jest.clearAllMocks()
            processor = new DistributionIndexProcessor('commonDir', {
                getServerById: jest.fn()
            }, 'serverId')

            mockModule1 = {
                getPath: jest.fn(() => 'path/to/module1.jar'),
                hasSubModules: jest.fn(() => false),
                rawModule: {
                    id: 'mod1',
                    artifact: {
                        size: 100,
                        url: 'url1',
                        SHA256: 'hash256_1',
                        SHA1: 'hash1_1'
                    }
                }
            }

            mockModule2 = {
                getPath: jest.fn(() => 'path/to/module2.jar'),
                hasSubModules: jest.fn(() => false),
                rawModule: {
                    id: 'mod2',
                    artifact: {
                        size: 200,
                        url: 'url2',
                        MD5: 'hashmd5_2',
                        SHA1: 'hash1_2'
                    }
                }
            }
        })

        it('should validate using SHA256 correctly', async () => {
            FileUtils.validateLocalFile.mockResolvedValue(true)

            await processor.validateModules([mockModule1])

            expect(FileUtils.validateLocalFile).toHaveBeenCalledWith(
                'path/to/module1.jar',
                HashAlgo.SHA256,
                'hash256_1',
                100
            )
        })

        it('should skip validation if SHA256 is missing (even if MD5/SHA1 present)', async () => {
            // mockModule2 only has MD5/SHA1
            const result = await processor.validateModules([mockModule2])

            expect(result).toHaveLength(0)
            expect(FileUtils.validateLocalFile).not.toHaveBeenCalled()
        })

        it('should return invalid modules when validation fails', async () => {
            FileUtils.validateLocalFile.mockResolvedValue(false)

            const result = await processor.validateModules([mockModule1])

            expect(result).toHaveLength(1)
            expect(result[0].id).toBe('mod1')
            expect(result[0].hash).toBe('hash256_1')
            expect(result[0].algo).toBe(HashAlgo.SHA256)
            expect(result[0].size).toBe(100)
        })

        it('should skip validation if no supported hash is found', async () => {
            const mockModuleNoHash = {
                getPath: jest.fn(() => 'path/to/no-hash.jar'),
                hasSubModules: jest.fn(() => false),
                rawModule: {
                    id: 'mod_no_hash',
                    artifact: {
                        MD5: 'some_md5'
                    }
                }
            }

            const result = await processor.validateModules([mockModuleNoHash])
            expect(result).toHaveLength(0)
            expect(FileUtils.validateLocalFile).not.toHaveBeenCalled()
        })

        it('should traverse submodules for validation', async () => {
            FileUtils.validateLocalFile.mockResolvedValue(true)
            mockModule1.hasSubModules.mockReturnValue(true)

            // Give mockModule2 a SHA256 so it gets validated
            mockModule2.rawModule.artifact.SHA256 = 'hash256_2'
            mockModule1.subModules = [mockModule2]

            await processor.validateModules([mockModule1])

            expect(FileUtils.validateLocalFile).toHaveBeenCalledTimes(2)
            expect(FileUtils.validateLocalFile).toHaveBeenCalledWith(
                'path/to/module1.jar',
                HashAlgo.SHA256,
                'hash256_1',
                100
            )
            expect(FileUtils.validateLocalFile).toHaveBeenCalledWith(
                'path/to/module2.jar',
                HashAlgo.SHA256,
                'hash256_2',
                200
            )
        })
    })
})
