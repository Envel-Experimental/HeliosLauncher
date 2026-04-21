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

jest.setTimeout(120000)

jest.mock('@core/configmanager', () => ({
    getP2POnlyMode: jest.fn(() => false),
    getNoServers: jest.fn(() => false),
    getNoMojang: jest.fn(() => false),
    getDataDirectory: jest.fn(() => 'dataDir'),
    getCommonDirectory: jest.fn(() => 'commonDir'),
    getLauncherDirectory: jest.fn(() => 'launcherDir'),
    getLauncherDirectorySync: jest.fn(() => 'launcherDirSync'),
    getSettings: jest.fn(() => ({})),
    isLoaded: jest.fn(() => true),
    load: jest.fn().mockResolvedValue(true),
    getLauncherDirectoryMain: jest.fn(() => 'launcherDir'),
    getP2PUploadLimit: jest.fn(() => 15),
    getP2PUploadEnabled: jest.fn(() => true)
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
const ConfigManager = require('@core/configmanager')

describe('Fix Verification Tests', () => {
    
    describe('JavaGuard Robustness', () => {
        beforeEach(() => {
            jest.clearAllMocks()
            global.fetch = jest.fn()
            Object.defineProperty(process, 'platform', { value: 'win32' })
            Object.defineProperty(process, 'arch', { value: 'x64' })
        })

        it('should match version even if passed as a string (Regression Fix)', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                arrayBuffer: async () => Buffer.from(JSON.stringify([
                    {
                        version: { major: 21 },
                        binary: {
                            os: 'windows', image_type: 'jdk', architecture: 'x64',
                            package: { link: 'http://test.com/j21.zip', size: 100, name: 'j21.zip', checksum: 'h' }
                        }
                    }
                ])),
                json: async () => ([
                    {
                        version: { major: 21 },
                        binary: {
                            os: 'windows', image_type: 'jdk', architecture: 'x64',
                            package: { link: 'http://test.com/j21.zip', size: 100, name: 'j21.zip', checksum: 'h' }
                        }
                    }
                ])
            })

            const result = await latestOpenJDK("21", "dataDir", null)
            expect(result).not.toBeNull()
            expect(result.id).toBe('j21.zip')
        })
    })

    describe('DownloadEngine Reporting', () => {
        it('should cap the number of filenames in error message (UI Fix)', async () => {
            const assets = Array.from({ length: 1 }, (_, i) => ({ 
                id: `file${i}.bin`, 
                url: 'http://err', 
                path: `file${i}.bin`,
                size: 100
            }))
            
            ConfigManager.getP2POnlyMode.mockReturnValue(false)

            try {
                await downloadQueue(assets)
                throw new Error('Should have thrown')
            } catch (e) {
                expect(e.message).toContain('file0.bin')
            }
        })
    })
})
