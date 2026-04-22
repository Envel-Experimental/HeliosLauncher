const path = require('path')

describe('MojangIndexProcessor Detailed Tests', () => {
    let MojangIndexProcessor
    let fs
    let FileUtils
    let MojangUtils
    let MirrorManager
    let DownloadEngine

    beforeEach(() => {
        jest.resetModules()

        // Mock Dependencies using Aliases
        jest.doMock('fs/promises', () => ({
            readFile: jest.fn(),
            writeFile: jest.fn(),
            access: jest.fn(),
            mkdir: jest.fn()
        }))

        jest.doMock('@common/FileUtils', () => ({
            getVersionJsonPath: jest.fn((d, v) => path.join(d, v + '.json')),
            validateLocalFile: jest.fn(),
            getLibraryDir: jest.fn().mockReturnValue('/mock/libs'),
            getVersionJarPath: jest.fn().mockReturnValue('/mock/client.jar'),
            safeEnsureDir: jest.fn().mockResolvedValue()
        }))

        jest.doMock('@common/MojangUtils', () => ({
            mcVersionAtLeast: jest.fn().mockReturnValue(true),
            isLibraryCompatible: jest.fn().mockReturnValue(true),
            getMojangOS: jest.fn().mockReturnValue('windows')
        }))

        jest.doMock('@core/dl/DownloadEngine', () => ({
            downloadFile: jest.fn().mockResolvedValue()
        }))

        jest.doMock('@network/MirrorManager', () => ({
            init: jest.fn().mockResolvedValue(),
            getSortedMirrors: jest.fn().mockReturnValue([])
        }))

        jest.doMock('@network/config', () => ({
            MOJANG_MIRRORS: [{ assets: 'http://mirror.assets' }],
            SUPPORT_CONFIG_URL: 'http://support.json'
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

        jest.doMock('p-limit', () => ({
            pLimit: jest.fn((limit) => (fn) => fn())
        }))

        // Mock global fetch
        global.fetch = jest.fn()

        const mipModule = require('@core/dl/MojangIndexProcessor')
        MojangIndexProcessor = mipModule.MojangIndexProcessor
        fs = require('fs/promises')
        FileUtils = require('@common/FileUtils')
        MojangUtils = require('@common/MojangUtils')
        MirrorManager = require('@network/MirrorManager')
        DownloadEngine = require('@core/dl/DownloadEngine')
    })

    const commonDir = '/mock/common'
    const version = '1.20.1'

    test('loadVersionManifest should handle fetch from remote and parse', async () => {
        const mockManifest = { versions: [{ id: '1.20.1', url: 'http://v.json' }] }
        fs.readFile.mockResolvedValue(JSON.stringify(mockManifest))

        const processor = new MojangIndexProcessor(commonDir, version)
        const res = await processor.loadVersionManifest()

        expect(DownloadEngine.downloadFile).toHaveBeenCalledWith(expect.objectContaining({
            id: 'version_manifest_v2.json'
        }))
        expect(res).toEqual(mockManifest)
    })

    test('loadVersionJson should handle ARM64 compatibility logic', async () => {
        Object.defineProperty(process, 'arch', { value: 'arm64' })
        MojangUtils.mcVersionAtLeast.mockReturnValue(false) // Not 1.19

        const mockManifest = { 
            latest: { release: '1.20.1' },
            versions: [
                { id: '1.18', url: 'http://1.18.json', sha1: 'h1' },
                { id: '1.20.1', url: 'http://1.20.json', sha1: 'h2' }
            ] 
        }
        
        const processor = new MojangIndexProcessor(commonDir, '1.18')
        
        // Mock loading JSONs
        jest.spyOn(processor, 'loadContentWithRemoteFallback').mockImplementation((url) => {
            if (url === 'http://1.18.json') return Promise.resolve({ libraries: [{ name: 'org.lwjgl:1' }, { name: 'other:1' }] })
            if (url === 'http://1.20.json') return Promise.resolve({ libraries: [{ name: 'org.lwjgl:2' }] })
        })

        const res = await processor.loadVersionJson('1.18', mockManifest)
        
        expect(res.libraries.length).toBe(2)
        expect(res.libraries.find(l => l.name === 'org.lwjgl:2')).toBeDefined()
        expect(res.libraries.find(l => l.name === 'other:1')).toBeDefined()
    })

    test('validateLibraries should handle standard and native libraries', async () => {
        const versionJson = {
            libraries: [
                { 
                    name: 'lib:std', 
                    rules: [], 
                    downloads: { artifact: { path: 'p1', sha1: 'h1', size: 10, url: 'http://lib1' } } 
                },
                { 
                    name: 'lib:native', 
                    rules: [], 
                    natives: { windows: 'win-arch' },
                    downloads: { classifiers: { 'win-arch': { path: 'p2', sha1: 'h2', size: 20, url: 'http://lib2' } } }
                }
            ]
        }
        FileUtils.validateLocalFile.mockResolvedValue(false) // Both missing
        MojangUtils.getMojangOS.mockReturnValue('windows')
        Object.defineProperty(process, 'arch', { value: 'x64' })

        const processor = new MojangIndexProcessor(commonDir, version)
        const libs = await processor.validateLibraries(versionJson)

        expect(libs.length).toBe(2)
        expect(libs[0].id).toBe('lib:std')
        expect(libs[1].id).toBe('lib:native')
    })

    test('validateClient and validateLogConfig should report missing files', async () => {
        const versionJson = {
            id: '1.20.1',
            downloads: {
                client: { sha1: 'hc', size: 100, url: 'https://piston-data.mojang.com/client' }
            },
            logging: {
                client: {
                    file: { id: 'log.xml', sha1: 'hl', size: 1, url: 'http://log' }
                }
            }
        }
        FileUtils.validateLocalFile.mockResolvedValue(false)
        MirrorManager.getSortedMirrors.mockReturnValue([{ client: 'http://mirror.client' }])

        const processor = new MojangIndexProcessor(commonDir, version)
        const client = await processor.validateClient(versionJson)
        const logConfig = await processor.validateLogConfig(versionJson)

        expect(client.length).toBe(1)
        expect(client[0].fallbackUrls).toContain('http://mirror.client/client')
        expect(logConfig.length).toBe(1)
        expect(logConfig[0].id).toBe('log.xml')
    })

    test('validateAssets should filter out non-essential language files', async () => {
        const assetIndex = {
            objects: {
                'minecraft/lang/en_us.json': { hash: 'h1', size: 10 },
                'minecraft/lang/fr_fr.json': { hash: 'h2', size: 10 },
                'minecraft/textures/block/stone.png': { hash: 'h3', size: 100 }
            }
        }
        FileUtils.validateLocalFile.mockResolvedValue(false) // All missing

        const processor = new MojangIndexProcessor(commonDir, version)
        const assets = await processor.validateAssets(assetIndex)

        expect(assets.find(a => a.id === 'minecraft/lang/en_us.json')).toBeDefined()
        expect(assets.find(a => a.id === 'minecraft/textures/block/stone.png')).toBeDefined()
        expect(assets.find(a => a.id === 'minecraft/lang/fr_fr.json')).toBeUndefined()
    })

    test('loadContentWithRemoteFallback should replace URLs for mirrors', async () => {
        MirrorManager.getSortedMirrors.mockReturnValue([
            { assets: 'http://mirror.assets' }
        ])

        const processor = new MojangIndexProcessor(commonDir, version)
        fs.readFile.mockResolvedValue('{"test": true}')
        
        const url = 'https://resources.download.minecraft.net/h1/hash'
        await processor.loadContentWithRemoteFallback(url, '/file.json', null)

        expect(DownloadEngine.downloadFile).toHaveBeenCalledWith(expect.objectContaining({
            fallbackUrls: ['http://mirror.assets/h1/hash']
        }))
    })

    test('validate should orchestrate all stages', async () => {
        const processor = new MojangIndexProcessor(commonDir, version)
        processor.assetIndex = { objects: {} }
        processor.versionJson = { libraries: [], id: '1.20.1', downloads: { client: { sha1: 'h', size: 0, url: '' } } }

        const onStageComplete = jest.fn()
        await processor.validate(onStageComplete)

        expect(onStageComplete).toHaveBeenCalledTimes(4)
    })
})
