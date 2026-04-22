describe('FullRepair', () => {
    let FullRepair
    let DistributionAPI
    let MojangIndexProcessor
    let DistributionIndexProcessor
    let downloadQueue
    let LoggerUtil
    let validateLocalFile

    beforeEach(() => {
        jest.resetModules()

        jest.doMock('../../../../../../../app/assets/js/core/common/DistributionAPI', () => ({
            DistributionAPI: jest.fn().mockImplementation(() => ({
                getDistributionLocalLoadOnly: jest.fn().mockResolvedValue({
                    getServerById: jest.fn().mockReturnValue({
                        rawServer: { minecraftVersion: '1.20.1' }
                    })
                })
            }))
        }))

        const mProcessor = {
            init: jest.fn().mockResolvedValue(undefined),
            totalStages: jest.fn().mockReturnValue(1),
            validate: jest.fn().mockImplementation(async (onProgress) => {
                if (onProgress) onProgress()
                return { asset1: { id: 'asset1', size: 100, path: 'path1', algo: 'sha1', hash: 'hash1' } }
            }),
            postDownload: jest.fn().mockResolvedValue(undefined)
        }

        jest.doMock('../../../../../../../app/assets/js/core/dl/MojangIndexProcessor', () => ({
            MojangIndexProcessor: jest.fn().mockImplementation(() => mProcessor)
        }))

        jest.doMock('../../../../../../../app/assets/js/core/dl/DistributionIndexProcessor', () => ({
            DistributionIndexProcessor: jest.fn().mockImplementation(() => mProcessor)
        }))

        jest.doMock('../../../../../../../app/assets/js/core/dl/DownloadEngine', () => ({
            downloadQueue: jest.fn().mockImplementation(async (assets, onProgress) => {
                if (onProgress) onProgress(100)
                return { asset1: 100 }
            })
        }))

        jest.doMock('../../../../../../../app/assets/js/core/util/LoggerUtil', () => ({
            LoggerUtil: {
                getLogger: jest.fn().mockReturnValue({
                    debug: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                    info: jest.fn()
                })
            }
        }))

        jest.doMock('../../../../../../../app/assets/js/core/common/FileUtils', () => ({
            validateLocalFile: jest.fn().mockResolvedValue(true)
        }))

        FullRepair = require('../../../../../../../app/assets/js/core/dl/FullRepair').FullRepair
        DistributionAPI = require('../../../../../../../app/assets/js/core/common/DistributionAPI').DistributionAPI
        MojangIndexProcessor = require('../../../../../../../app/assets/js/core/dl/MojangIndexProcessor').MojangIndexProcessor
        DistributionIndexProcessor = require('../../../../../../../app/assets/js/core/dl/DistributionIndexProcessor').DistributionIndexProcessor
        downloadQueue = require('../../../../../../../app/assets/js/core/dl/DownloadEngine').downloadQueue
        validateLocalFile = require('../../../../../../../app/assets/js/core/common/FileUtils').validateLocalFile
    })

    it('should initialize correctly', () => {
        const fr = new FullRepair('common', 'instance', 'launcher', 'server1', false, [])
        expect(fr.commonDirectory).toBe('common')
        expect(fr.assets).toEqual([])
    })

    it('should verify files correctly', async () => {
        const fr = new FullRepair('common', 'instance', 'launcher', 'server1', false, [])
        const onProgress = jest.fn()
        const count = await fr.verifyFiles(onProgress)
        
        expect(count).toBe(2)
        expect(onProgress).toHaveBeenCalled()
        expect(fr.assets.length).toBe(2)
    })

    it('should download files correctly', async () => {
        const fr = new FullRepair('common', 'instance', 'launcher', 'server1', false, [])
        fr.assets = [{ id: 'asset1', size: 100, path: 'path1' }]
        // We need processors to be initialized for download() to call postDownload
        await fr.verifyFiles()
        
        const onProgress = jest.fn()
        await fr.download(onProgress)
        
        expect(downloadQueue).toHaveBeenCalled()
        expect(onProgress).toHaveBeenCalled()
    })

    it('should handle size mismatch during download', async () => {
        const fr = new FullRepair('common', 'instance', 'launcher', 'server1', false, [])
        fr.assets = [{ id: 'asset1', size: 100, path: 'path1', algo: 'sha1', hash: 'hash1' }]
        await fr.verifyFiles()
        
        downloadQueue.mockResolvedValueOnce({ asset1: 50 }) // Mismatch
        validateLocalFile.mockResolvedValueOnce(false) // Hash fail
        
        await fr.download()
        expect(validateLocalFile).toHaveBeenCalled()
    })

    it('should handle no assets to download', async () => {
        const fr = new FullRepair('common', 'instance', 'launcher', 'server1', false, [])
        fr.assets = []
        const onProgress = jest.fn()
        await fr.download(onProgress)
        expect(onProgress).toHaveBeenCalledWith(100)
    })

    it('should have deprecated methods for compatibility', async () => {
        const fr = new FullRepair('common', 'instance', 'launcher', 'server1', false, [])
        await fr.spawnReceiver()
        fr.destroyReceiver()
        expect(fr.childProcess).toBeDefined()
        expect(fr.childProcess.on).toBeDefined()
    })
})
