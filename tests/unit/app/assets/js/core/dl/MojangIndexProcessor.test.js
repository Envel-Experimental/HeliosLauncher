// Mock dependencies
const mockDownloadFile = jest.fn().mockResolvedValue()
jest.mock('../../../../../../../app/assets/js/core/dl/DownloadEngine', () => ({
    downloadFile: mockDownloadFile
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

jest.mock('../../../../../../../network/MirrorManager', () => ({
    init: jest.fn().mockResolvedValue(),
    getSortedMirrors: jest.fn().mockReturnValue([
        { assets: 'http://mirror/assets', version_manifest: 'http://mirror/manifest' }
    ])
}))

const mockFs = {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    access: jest.fn()
}
jest.mock('fs/promises', () => mockFs)

const { MojangIndexProcessor } = require('../../../../../../../app/assets/js/core/dl/MojangIndexProcessor')

describe('MojangIndexProcessor', () => {
    const commonDir = '/mock/common'
    const version = '1.20.1'
    let processor

    beforeEach(() => {
        jest.clearAllMocks()
        processor = new MojangIndexProcessor(commonDir, version)
        global.fetch = jest.fn()
    })

    describe('loadVersionManifest', () => {
        it('should download and parse the version manifest', async () => {
            const mockManifest = { versions: [{ id: '1.20.1' }] }
            mockFs.readFile.mockResolvedValue(JSON.stringify(mockManifest))
            
            const result = await processor.loadVersionManifest()
            
            expect(mockDownloadFile).toHaveBeenCalled()
            expect(result).toEqual(mockManifest)
        })

        it('should fallback to cache if download fails', async () => {
            mockDownloadFile.mockRejectedValueOnce(new Error('Network fail'))
            const mockManifest = { versions: [{ id: 'cached' }] }
            mockFs.access.mockResolvedValue() // Cache exists
            mockFs.readFile.mockResolvedValue(JSON.stringify(mockManifest))
            
            const result = await processor.loadVersionManifest()
            
            expect(result.versions[0].id).toBe('cached')
        })
    })

    describe('getMirrorManifest', () => {
        it('should fetch and cache mirror manifest', async () => {
            const mockManifest = { versions: [] }
            global.fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockManifest)
            })

            const mirror = { version_manifest: 'http://mirror/v1' }
            const result = await processor.getMirrorManifest(mirror)
            
            expect(result).toEqual(mockManifest)
            expect(global.fetch).toHaveBeenCalledWith('http://mirror/v1')
            
            // Second call should use cache
            await processor.getMirrorManifest(mirror)
            expect(global.fetch).toHaveBeenCalledTimes(1)
        })
    })

    describe('URL Fallbacks', () => {
        it('should correctly transform URLs for mirrors', async () => {
            const url = 'https://resources.download.minecraft.net/ab/abcdef'
            const filePath = '/tmp/test'
            
            mockFs.readFile.mockResolvedValue('{}')
            
            await processor.loadContentWithRemoteFallback(url, filePath, null)
            
            expect(mockDownloadFile).toHaveBeenCalledWith(expect.objectContaining({
                url: url,
                fallbackUrls: expect.arrayContaining(['http://mirror/assets/ab/abcdef'])
            }))
        })
    })
})
