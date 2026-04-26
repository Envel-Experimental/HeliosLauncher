const path = require('path')
const { Readable } = require('stream')

// Mock Dependencies using Aliases
jest.mock('@core/util/LoggerUtil', () => ({
    LoggerUtil: {
        getLogger: jest.fn(() => ({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        }))
    }
}))

jest.mock('@common/FileUtils', () => ({
    validateLocalFile: jest.fn(),
    safeEnsureDir: jest.fn().mockResolvedValue()
}))

jest.mock('@core/util/NodeUtil', () => ({
    ensureDecodedPath: jest.fn(p => p),
    sleep: jest.fn().mockResolvedValue()
}))

jest.mock('@core/configmanager', () => ({
    getDataDirectory: jest.fn().mockReturnValue('/mock/data'),
    getCommonDirectory: jest.fn().mockResolvedValue('/mock/common'),
    getCommonDirectorySync: jest.fn().mockReturnValue('/mock/common'),
    getLauncherDirectorySync: jest.fn().mockReturnValue('/mock/launcher'),
    getP2PUploadEnabled: jest.fn().mockReturnValue(true),
    getLocalOptimization: jest.fn().mockReturnValue(true),
    getNoServers: jest.fn().mockReturnValue(false),
    getNoMojang: jest.fn().mockReturnValue(false),
    getP2POnlyMode: jest.fn().mockReturnValue(false),
    isLoaded: jest.fn().mockReturnValue(true),
    getP2PUploadLimit: jest.fn().mockReturnValue(100)
}))

// Mock Network Modules directly
jest.mock('@network/P2PEngine', () => ({
    start: jest.fn().mockResolvedValue(),
    getOptimalConcurrency: jest.fn(l => l),
    peers: [],
    stop: jest.fn().mockResolvedValue()
}))

jest.mock('@network/RaceManager', () => ({
    handle: jest.fn()
}))

jest.mock('@network/MirrorManager', () => ({
    reportSuccess: jest.fn(),
    reportFailure: jest.fn(),
    getSortedMirrors: jest.fn().mockReturnValue([]),
    isMirrorUrl: jest.fn().mockReturnValue(false)
}))

jest.mock('@network/config', () => ({
    DISTRO_PUB_KEYS: ['mock-key']
}))

jest.mock('@core/util/SignatureUtils', () => ({
    verifyDistribution: jest.fn().mockReturnValue(true)
}))

// Mock stream/promises pipeline
jest.mock('stream/promises', () => ({
    pipeline: jest.fn().mockResolvedValue()
}))

// Mock fs/promises
jest.mock('fs/promises', () => ({
    readdir: jest.fn(),
    stat: jest.fn(),
    unlink: jest.fn(),
    access: jest.fn(),
    rename: jest.fn(),
    open: jest.fn(),
    readFile: jest.fn()
}))

// Mock fsSync
jest.mock('fs', () => ({
    existsSync: jest.fn(),
    statSync: jest.fn(),
    createWriteStream: jest.fn(),
    unlinkSync: jest.fn(),
    realpathSync: jest.fn(p => p)
}))

const DownloadEngine = require('@core/dl/DownloadEngine')
const P2PEngine = require('@network/P2PEngine')
const RaceManager = require('@network/RaceManager')
const FileUtils = require('@common/FileUtils')

describe('DownloadEngine Detailed Tests', () => {

    beforeEach(() => {
        jest.clearAllMocks()
        P2PEngine.peers = []
        if (global.__RESET_DL_ENGINE_COUNTERS__) global.__RESET_DL_ENGINE_COUNTERS__()
    })

    describe('cleanupStaleTempFiles', () => {
        it('should scan directories and delete old .tmp files', async () => {
            const fs = require('fs/promises')
            const now = Date.now()
            const oldTime = now - (25 * 60 * 60 * 1000) // 25 hours ago
            
            fs.readdir.mockResolvedValueOnce([
                { name: 'old.tmp', isFile: () => true, isDirectory: () => false },
                { name: 'assets', isFile: () => false, isDirectory: () => true }
            ])
            
            fs.stat.mockImplementation(p => {
                if (p.includes('old.tmp')) return Promise.resolve({ mtimeMs: oldTime })
                return Promise.resolve({ mtimeMs: now })
            })

            fs.readdir.mockResolvedValueOnce([])

            await DownloadEngine.cleanupStaleTempFiles()

            expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('old.tmp'))
        })
    })

    describe('downloadFile', () => {
        const asset = {
            id: 'test-asset',
            path: '/mock/data/file.jar',
            url: 'http://primary.com/file.jar',
            algo: 'sha1',
            hash: 'mockhash',
            size: 1000
        }

        it('should skip download if file is already valid', async () => {
            const fs = require('fs/promises')
            fs.access.mockResolvedValue()
            FileUtils.validateLocalFile.mockResolvedValue(true)
            
            await DownloadEngine.downloadFile(asset)
            expect(RaceManager.handle).not.toHaveBeenCalled()
        })

        it('should perform download via RaceManager using p2pStream', async () => {
            const fs = require('fs/promises')
            const fsSync = require('fs')
            fs.access.mockRejectedValue(new Error('ENOENT'))
            
            RaceManager.handle.mockImplementation(() => {
                const mockP2PStream = new Readable({ read() {} })
                mockP2PStream.push('mock data')
                mockP2PStream.push(null)
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    p2pStream: mockP2PStream
                })
            })
            
            FileUtils.validateLocalFile.mockResolvedValue(true)
            fsSync.createWriteStream.mockReturnValue({ on: jest.fn() })
            fsSync.existsSync.mockReturnValue(true)

            await DownloadEngine.downloadFile(asset)

            expect(RaceManager.handle).toHaveBeenCalled()
            expect(fs.rename).toHaveBeenCalled()
        })
    })

    describe('downloadQueue', () => {
        it('should process multiple assets', async () => {
            const fs = require('fs/promises')
            const fsSync = require('fs')
            const assets = [
                { id: 'a1', path: 'p1', size: 100, url: 'http://u1.com' }
            ]

            RaceManager.handle.mockImplementation(() => {
                const mockP2PStream = new Readable({ read() {} })
                mockP2PStream.push(null)
                return Promise.resolve({
                    ok: true,
                    p2pStream: mockP2PStream
                })
            })
            fs.access.mockRejectedValue(new Error('ENOENT'))
            FileUtils.validateLocalFile.mockResolvedValue(true)
            fsSync.existsSync.mockReturnValue(true)

            await DownloadEngine.downloadQueue(assets)
            expect(RaceManager.handle).toHaveBeenCalled()
        })
    })
})
