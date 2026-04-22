const { EventEmitter } = require('events')
const path = require('path')

// Mock dependencies at the top
jest.mock('../../../../app/assets/js/core/util/LoggerUtil', () => ({
    LoggerUtil: { getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }
}))

jest.mock('../../../../app/assets/js/core/common/FileUtils', () => ({
    validateLocalFile: jest.fn().mockResolvedValue(true),
    safeEnsureDir: jest.fn().mockResolvedValue()
}))

jest.mock('../../../../app/assets/js/core/util/NodeUtil', () => ({
    ensureDecodedPath: (p) => p,
    sleep: jest.fn().mockResolvedValue()
}))

jest.mock('../../../../app/assets/js/core/configmanager', () => ({
    getDataDirectory: jest.fn().mockReturnValue('/data'),
    getCommonDirectory: jest.fn().mockResolvedValue('/common'),
    getLauncherDirectory: jest.fn().mockResolvedValue('/launcher'),
    getLauncherDirectorySync: jest.fn().mockReturnValue('/launcher'),
    getP2POnlyMode: jest.fn().mockReturnValue(false),
    getNoServers: jest.fn().mockReturnValue(false),
    getNoMojang: jest.fn().mockReturnValue(false),
    isLoaded: jest.fn().mockReturnValue(true),
    getP2PUploadLimit: jest.fn().mockReturnValue(15)
}))

jest.mock('../../../../../network/P2PEngine', () => ({
    start: jest.fn().mockResolvedValue(),
    getOptimalConcurrency: jest.fn().mockReturnValue(5),
    peers: []
}), { virtual: true })

jest.mock('../../../../../network/RaceManager', () => ({
    handle: jest.fn().mockResolvedValue({
        ok: true,
        body: { getReader: () => ({ read: () => Promise.resolve({ done: true }) }) }
    })
}), { virtual: true })

jest.mock('../../../../../network/MirrorManager', () => ({
    reportSuccess: jest.fn(),
    reportFailure: jest.fn()
}), { virtual: true })

// Mock fs/promises
jest.mock('fs/promises', () => ({
    readdir: jest.fn().mockResolvedValue([]),
    stat: jest.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    unlink: jest.fn().mockResolvedValue(),
    access: jest.fn().mockRejectedValue(new Error('not found')),
    rename: jest.fn().mockResolvedValue(),
    open: jest.fn()
}))

// Mock fs (sync)
jest.mock('fs', () => ({
    existsSync: jest.fn().mockReturnValue(false),
    statSync: jest.fn(),
    createWriteStream: jest.fn().mockReturnValue(new EventEmitter())
}))

const DownloadEngine = require('../../../../app/assets/js/core/dl/DownloadEngine')

describe('DownloadEngine', () => {
    beforeEach(() => {
        jest.resetAllMocks()
        
        // Reset internal engine counters to prevent leaks between tests
        if (global.__RESET_DL_ENGINE_COUNTERS__) {
            global.__RESET_DL_ENGINE_COUNTERS__();
        }

        // Restore common mock behaviors
        const FileUtils = require('../../../../app/assets/js/core/common/FileUtils')
        FileUtils.validateLocalFile.mockResolvedValue(true)
        FileUtils.safeEnsureDir.mockResolvedValue()

        const ConfigManager = require('../../../../app/assets/js/core/configmanager')
        ConfigManager.getDataDirectory.mockReturnValue('/data')
        ConfigManager.getCommonDirectory.mockResolvedValue('/common')
        ConfigManager.getLauncherDirectory.mockResolvedValue('/launcher')
        ConfigManager.getLauncherDirectorySync.mockReturnValue('/launcher')
        ConfigManager.getP2POnlyMode.mockReturnValue(false)
        ConfigManager.getNoServers.mockReturnValue(false)
        ConfigManager.getNoMojang.mockReturnValue(false)
        ConfigManager.isLoaded.mockReturnValue(true)
        ConfigManager.getP2PUploadLimit.mockReturnValue(15)

        const P2PEngine = require('../../../../../network/P2PEngine')
        P2PEngine.getOptimalConcurrency.mockReturnValue(5)
    })

    describe('cleanupStaleTempFiles', () => {
        it('should scan directories and delete old .tmp files', async () => {
            const fs = require('fs/promises')
            fs.readdir.mockResolvedValueOnce([
                { name: 'old.tmp', isFile: () => true, isDirectory: () => false }
            ])
            fs.stat.mockResolvedValueOnce({ mtimeMs: Date.now() - 48 * 60 * 60 * 1000 }) // 48h old

            await DownloadEngine.cleanupStaleTempFiles()
            expect(fs.unlink).toHaveBeenCalled()
        })
    })

    describe('downloadFile', () => {
        const asset = { id: 'test', path: '/test.jar', size: 100, url: 'http://test' }

        it('should skip if file exists and is valid', async () => {
            const fs = require('fs/promises')
            const { validateLocalFile } = require('../../../../app/assets/js/core/common/FileUtils')
            fs.access.mockResolvedValue()
            validateLocalFile.mockResolvedValue(true)

            await DownloadEngine.downloadFile(asset)
            expect(validateLocalFile).toHaveBeenCalled()
        })

        /*it('should handle successful download via RaceManager', async () => {
            const { Readable, PassThrough } = require('stream')
            const RaceManager = require('../../../../../network/RaceManager')
            const { validateLocalFile } = require('../../../../app/assets/js/core/common/FileUtils')
            const fsSync = require('fs')
            
            // 1st call: false (need to download), 2nd call: true (validation success)
            validateLocalFile.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
            
            const stream = new PassThrough()
            fsSync.createWriteStream.mockReturnValue(stream)

            // Use p2pStream path which uses Node Streams directly
            const mockStream = new Readable({
                read() {
                    this.push(Buffer.from('data'))
                    this.push(null)
                }
            })

            RaceManager.handle.mockResolvedValue({
                ok: true,
                p2pStream: mockStream
            })

            const promise = DownloadEngine.downloadFile(asset)
            
            // Pipeline will end when mockStream ends
            await promise

            expect(RaceManager.handle).toHaveBeenCalled()
        }, 10000)*/
    })

    describe('downloadQueue', () => {
        it('should process assets in parallel', async () => {
            const assets = [{ id: 'a1', path: '/a1' }, { id: 'a2', path: '/a2' }]
            const results = await DownloadEngine.downloadQueue(assets)
            expect(Object.keys(results)).toContain('a1')
            expect(Object.keys(results)).toContain('a2')
        })
    })
})
