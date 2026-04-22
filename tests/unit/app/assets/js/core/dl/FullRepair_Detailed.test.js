describe('FullRepair Detailed Tests', () => {
    let FullRepair
    let DistributionAPI
    let MojangIndexProcessor
    let DistributionIndexProcessor
    let DownloadEngine
    let FileUtils

    beforeEach(() => {
        jest.resetModules()

        // Mock Dependencies
        jest.doMock('@common/DistributionAPI', () => ({
            DistributionAPI: jest.fn().mockImplementation(() => ({
                getDistributionLocalLoadOnly: jest.fn().mockResolvedValue({
                    getServerById: jest.fn().mockReturnValue({
                        rawServer: { minecraftVersion: '1.12.2' }
                    })
                })
            }))
        }))

        jest.doMock('@core/dl/MojangIndexProcessor', () => ({
            MojangIndexProcessor: jest.fn().mockImplementation(() => ({
                init: jest.fn().mockResolvedValue(),
                totalStages: jest.fn().mockReturnValue(1),
                validate: jest.fn().mockImplementation(async (cb) => {
                    if (cb) await cb() // Call the progress callback
                    return { 'asset1': [{ id: 'asset1', size: 100, path: 'p1', algo: 'sha1', hash: 'h1' }] }
                }),
                postDownload: jest.fn().mockResolvedValue()
            }))
        }))

        jest.doMock('@core/dl/DistributionIndexProcessor', () => ({
            DistributionIndexProcessor: jest.fn().mockImplementation(() => ({
                init: jest.fn().mockResolvedValue(),
                totalStages: jest.fn().mockReturnValue(1),
                validate: jest.fn().mockImplementation(async (cb) => {
                    if (cb) await cb() // Call the progress callback
                    return { 'asset2': [{ id: 'asset2', size: 200, path: 'p2', algo: 'sha1', hash: 'h2' }] }
                }),
                postDownload: jest.fn().mockResolvedValue()
            }))
        }))

        jest.doMock('@core/dl/DownloadEngine', () => ({
            downloadQueue: jest.fn().mockImplementation(async (assets, cb) => {
                if (cb) cb(assets.reduce((acc, a) => acc + a.size, 0)) // Report full size immediately
                return assets.reduce((acc, a) => ({ ...acc, [a.id]: a.size }), {})
            })
        }))

        jest.doMock('@common/FileUtils', () => ({
            validateLocalFile: jest.fn().mockResolvedValue(true)
        }))

        jest.doMock('@core/util/LoggerUtil', () => ({
            LoggerUtil: {
                getLogger: jest.fn(() => ({
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn()
                }))
            }
        }))

        FullRepair = require('@core/dl/FullRepair').FullRepair
        DistributionAPI = require('@common/DistributionAPI').DistributionAPI
        MojangIndexProcessor = require('@core/dl/MojangIndexProcessor').MojangIndexProcessor
        DistributionIndexProcessor = require('@core/dl/DistributionIndexProcessor').DistributionIndexProcessor
        DownloadEngine = require('@core/dl/DownloadEngine')
        FileUtils = require('@common/FileUtils')
    })

    test('verifyFiles should initialize processors and accumulate assets', async () => {
        const repair = new FullRepair('/common', '/instance', '/launcher', 'serverId', false, [])
        const onProgress = jest.fn()

        const count = await repair.verifyFiles(onProgress)

        expect(count).toBe(2)
        expect(onProgress).toHaveBeenCalled()
    })

    test('download should call downloadQueue and post-download hooks', async () => {
        const repair = new FullRepair('/common', '/instance', '/launcher', 'serverId', false, [])
        await repair.verifyFiles()
        
        const onProgress = jest.fn()
        await repair.download(onProgress)

        expect(DownloadEngine.downloadQueue).toHaveBeenCalled()
        expect(onProgress).toHaveBeenCalledWith(100)
    })

    test('download should warn and re-verify if size mismatch', async () => {
        const repair = new FullRepair('/common', '/instance', '/launcher', 'serverId', false, [])
        await repair.verifyFiles()

        // Mock size mismatch
        DownloadEngine.downloadQueue.mockResolvedValue({ 'asset1': 50, 'asset2': 200 })
        FileUtils.validateLocalFile.mockResolvedValue(false)

        await repair.download()

        expect(FileUtils.validateLocalFile).toHaveBeenCalled()
    })

    test('verifyFiles should handle processor initialization failure', async () => {
        const repair = new FullRepair('/common', '/instance', '/launcher', 'serverId', false, [])
        
        // Use the mock instance from constructor to fail init
        // But since we want to fail it for this specific test, we can use a spy on the prototype if we did it right, 
        // but here the mock is a mock object returned by the constructor mock.
        
        // Actually, the easiest is to just re-mock for this test
        const mip = require('@core/dl/MojangIndexProcessor').MojangIndexProcessor
        mip.mockImplementationOnce(() => ({
            init: jest.fn().mockRejectedValue(new Error('Network error'))
        }))

        await expect(repair.verifyFiles()).rejects.toThrow('Network error')
    })

    test('download should handle downloadQueue failure', async () => {
        const repair = new FullRepair('/common', '/instance', '/launcher', 'serverId', false, [])
        await repair.verifyFiles()

        // Force download failure
        const de = require('@core/dl/DownloadEngine')
        de.downloadQueue.mockRejectedValueOnce(new Error('Connection lost'))

        await expect(repair.download()).rejects.toThrow('Connection lost')
    })

    test('verifyFiles should correctly report asset counts', async () => {
        // We need to re-mock the processors for this test
        const mip = require('@core/dl/MojangIndexProcessor').MojangIndexProcessor
        const dip = require('@core/dl/DistributionIndexProcessor').DistributionIndexProcessor

        mip.mockImplementationOnce(() => ({
            init: jest.fn().mockResolvedValue(),
            totalStages: jest.fn().mockReturnValue(1),
            validate: jest.fn().mockResolvedValue({
                'a1': [{ id: 'a1', size: 100, path: 'p1' }],
                'a2': [{ id: 'a2', size: 100, path: 'p2' }]
            }),
            postDownload: jest.fn().mockResolvedValue()
        }))

        dip.mockImplementationOnce(() => ({
            init: jest.fn().mockResolvedValue(),
            totalStages: jest.fn().mockReturnValue(1),
            validate: jest.fn().mockResolvedValue({
                'a3': [{ id: 'a3', size: 100, path: 'p3' }]
            }),
            postDownload: jest.fn().mockResolvedValue()
        }))

        const repair = new FullRepair('/common', '/instance', '/launcher', 'serverId', false, [])
        const count = await repair.verifyFiles()
        expect(count).toBe(3)
    })
})
