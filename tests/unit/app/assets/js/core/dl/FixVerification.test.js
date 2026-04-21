// Defining global mocks BEFORE requiring anything
global.__P2P_MOCK__ = {
    start: jest.fn().mockResolvedValue(true),
    stop: jest.fn().mockResolvedValue(true),
    peers: [],
    getOptimalConcurrency: jest.fn(() => 4),
    getLoadStatus: jest.fn(() => 'normal'),
    once: jest.fn(),
    off: jest.fn(),
    on: jest.fn(),
    emit: jest.fn()
}

global.__RACE_MOCK__ = {
    handle: jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
    }),
    getDownloadProgress: jest.fn(() => 0)
}

jest.setTimeout(10000)

// Mock sleep to be instant in tests
jest.mock('@core/util/NodeUtil', () => ({
    ...jest.requireActual('@core/util/NodeUtil'),
    sleep: jest.fn().mockResolvedValue(true)
}))

jest.mock('@core/configmanager', () => ({
    getP2POnlyMode: jest.fn(() => false),
    getNoServers: jest.fn(() => false),
    getNoMojang: jest.fn(() => false),
    getDataDirectory: jest.fn(() => 'dataDir'),
    getCommonDirectory: jest.fn().mockResolvedValue('commonDir'),
    getLauncherDirectory: jest.fn(() => 'launcherDir'),
    getLauncherDirectorySync: jest.fn(() => 'launcherDir'),
    getSettings: jest.fn(() => ({})),
    isLoaded: jest.fn(() => true),
    load: jest.fn().mockResolvedValue(true),
    getP2PUploadLimit: jest.fn(() => 15),
    getP2PUploadEnabled: jest.fn(() => true),
    save: jest.fn(),
    setJavaExecutable: jest.fn(),
    fetchWithTimeout: jest.fn() // Add this as well
}))

// Mock network config and managers to avoid external calls
jest.mock('../../../../../../../network/config', () => ({
    MOJANG_MIRRORS: [],
    DISTRO_PUB_KEYS: []
}))

jest.mock('../../../../../../../network/MirrorManager', () => ({
    initialized: true,
    getSortedMirrors: jest.fn(() => [])
}))

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
    validateLocalFile: jest.fn().mockResolvedValue(false),
    safeEnsureDir: jest.fn().mockResolvedValue(true)
}))

const { latestOpenJDK } = require('@core/java/JavaGuard')
const { downloadQueue } = require('@core/dl/DownloadEngine')

describe('Fix Verification Tests', () => {
    
    test('JavaGuard should identify latest OpenJDK', async () => {
        // Mock global fetch for Adoptium API
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ([
                {
                    version: { major: 17 },
                    binary: {
                        os: 'windows', 
                        image_type: 'jdk', 
                        architecture: 'x64',
                        package: { 
                            link: 'http://test.com/j17.zip', 
                            size: 100, 
                            name: 'j17.zip', 
                            checksum: 'h' 
                        }
                    }
                }
            ])
        })

        // Ensure process.platform matches mock
        Object.defineProperty(process, 'platform', { value: 'win32' })
        Object.defineProperty(process, 'arch', { value: 'x64' })

        const java = await latestOpenJDK(17, 'dataDir')
        expect(java).not.toBeNull()
        expect(java.id).toBe('j17.zip')
    })

    test('DownloadEngine should handle errors without hanging', async () => {
        const assets = [{ id: 'test', url: 'http://err', path: 'test.jar' }]
        await expect(downloadQueue(assets)).rejects.toThrow()
    })
})
