const { MirrorManager, ConfigUpdater } = require('../../app/assets/js/mirrormanager')
const ConfigManager = require('../../app/assets/js/configmanager')
const fs = require('fs-extra')
const path = require('path')

// Mock dependencies
jest.mock('fs-extra')
jest.mock('../../app/assets/js/configmanager')
jest.mock('@envel/helios-core', () => ({
    LoggerUtil: {
        getLogger: () => ({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        })
    }
}))

describe('MirrorManager', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        // Reset mirrors
        // The MirrorManager instance is stateful and singleton-like for this test context.
        // We can't easily reset its `mirrors` property to "pre-constructor" state because it's already instantiated.
        // But `init` rewrites `this.mirrors` based on defaults and saved config.
        // Wait, `init` does `const uniqueMirrors = new Set([...DEFAULT_MIRRORS, ...savedMirrors])`
        // DEFAULT_MIRRORS is private in the module.
        // So `init` always merges with defaults.

        // We mock currentMirror to null
        MirrorManager.currentMirror = null
        global.fetch = jest.fn()
        // Default mock for ConfigManager.getLauncherDirectory
        ConfigManager.getLauncherDirectory.mockReturnValue('/test/path')
    })

    test('should initialize with defaults if no saved config', async () => {
        fs.pathExists.mockResolvedValue(false)
        await MirrorManager.init()
        expect(MirrorManager.mirrors).toEqual(['https://f-launcher.ru/fox/new/'])
    })

    test('should merge saved mirrors with defaults', async () => {
        fs.pathExists.mockResolvedValue(true)
        fs.readJson.mockResolvedValue({
            mirrors: ['https://saved.com/']
        })

        await MirrorManager.init()
        expect(MirrorManager.mirrors).toContain('https://f-launcher.ru/fox/new/')
        expect(MirrorManager.mirrors).toContain('https://saved.com/')
    })

    test('should validate config strictly', () => {
        expect(MirrorManager.validateConfig({ mirrors: ['https://valid.com'] })).toBe(true)
        expect(MirrorManager.validateConfig({ mirrors: ['invalid-url'] })).toBe(false)
        expect(MirrorManager.validateConfig({ mirrors: 'not-array' })).toBe(false)
        expect(MirrorManager.validateConfig({})).toBe(false)
    })

    test('selectBestMirror should pick the fastest mirror', async () => {
        MirrorManager.mirrors = ['https://slow.com/', 'https://fast.com/']

        // Mock fetch to simulate latency
        global.fetch.mockImplementation((url) => {
            if (url.includes('fast.com')) {
                return Promise.resolve({ ok: true, status: 200 })
            }
            return new Promise(resolve => setTimeout(() => resolve({ ok: true, status: 200 }), 100))
        })

        const best = await MirrorManager.selectBestMirror()
        expect(best).toBe('https://fast.com/')
        expect(MirrorManager.currentMirror).toBe('https://fast.com/')
    })

    test('selectBestMirror should handle failures', async () => {
        MirrorManager.mirrors = ['https://fail.com/', 'https://succeed.com/']

        global.fetch.mockImplementation((url) => {
            if (url.includes('fail.com')) {
                return Promise.reject(new Error('Network error'))
            }
            return Promise.resolve({ ok: true, status: 200 })
        })

        const best = await MirrorManager.selectBestMirror()
        expect(best).toBe('https://succeed.com/')
    })

    test('getNextMirror should cycle through mirrors', () => {
        MirrorManager.mirrors = ['https://one.com/', 'https://two.com/']
        MirrorManager.currentMirror = 'https://one.com/'

        expect(MirrorManager.getNextMirror()).toBe('https://two.com/')
        expect(MirrorManager.currentMirror).toBe('https://two.com/')
        expect(MirrorManager.getNextMirror()).toBe('https://one.com/')
    })
})

describe('ConfigUpdater', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        global.fetch = jest.fn()
        ConfigManager.getLauncherDirectory.mockReturnValue('/test/path')
    })

    test('checkForUpdate should download and save valid config', async () => {
        MirrorManager.currentMirror = 'https://current.com/'

        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ mirrors: ['https://new.com/'] })
        })

        await ConfigUpdater.checkForUpdate(MirrorManager)

        expect(fs.writeJson).toHaveBeenCalledWith(
            path.join('/test/path', 'distro-config.json'),
            { mirrors: ['https://new.com/'] }
        )
    })

    test('checkForUpdate should ignore invalid config', async () => {
        MirrorManager.currentMirror = 'https://current.com/'

        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ mirrors: 'invalid' })
        })

        await ConfigUpdater.checkForUpdate(MirrorManager)

        expect(fs.writeJson).not.toHaveBeenCalled()
    })
})
