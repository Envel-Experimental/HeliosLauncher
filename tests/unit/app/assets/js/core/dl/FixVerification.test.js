// Mock Dependencies FIRST
jest.mock('@app/assets/js/core/java/JavaUtils', () => ({
    Platform: { WIN32: 'win32' },
    javaExecFromRoot: jest.fn(p => p),
    ensureJavaDirIsRoot: jest.fn(p => p)
}))

jest.mock('@app/assets/js/core/util/LoggerUtil', () => ({
    LoggerUtil: {
        getLogger: jest.fn(() => ({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        }))
    }
}))

jest.mock('@network/config', () => ({
    MOJANG_MIRRORS: [],
    BOOTSTRAP_NODES: [],
    MAX_PARALLEL_DOWNLOADS: 4
}))

jest.mock('@app/assets/js/core/dl/Asset', () => ({
    HashAlgo: { SHA1: 'sha1', SHA256: 'sha256' }
}))

jest.mock('@app/assets/js/core/configmanager', () => ({
    getP2POnlyMode: jest.fn(),
    getNoServers: jest.fn(() => false),
    getNoMojang: jest.fn(() => false),
    getDataDirectory: jest.fn(() => 'dataDir'),
    getCommonDirectory: jest.fn(() => 'commonDir'),
    getLauncherDirectory: jest.fn(() => 'launcherDir'),
    getLauncherDirectorySync: jest.fn(() => 'launcherDirSync'),
    getSettings: jest.fn(() => ({})),
    isLoaded: jest.fn(() => true),
    load: jest.fn().mockResolvedValue(true)
}))

jest.mock('@network/P2PEngine', () => ({
    start: jest.fn().mockResolvedValue(true),
    peers: [],
    getOptimalConcurrency: jest.fn(() => 4)
}))

jest.mock('@app/assets/js/core/common/FileUtils', () => ({
    validateLocalFile: jest.fn().mockResolvedValue(false),
    safeEnsureDir: jest.fn().mockResolvedValue(true)
}))

// NOW require modules
const { latestOpenJDK } = require('@app/assets/js/core/java/JavaGuard')
const { downloadQueue } = require('@app/assets/js/core/dl/DownloadEngine')
const ConfigManager = require('@app/assets/js/core/configmanager')

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

        it('should fallback to ZIP if MSI installer is missing (Regression Fix)', async () => {
            global.fetch.mockImplementation((url) => {
                if (url.includes('hotspot')) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => [
                            {
                                version: { major: 21 },
                                binary: {
                                    os: 'windows', image_type: 'jdk', architecture: 'x64',
                                    package: { link: 'http://test.com/j21.zip', size: 100, name: 'j21.zip', checksum: 'h' }
                                }
                            }
                        ]
                    })
                }
                return Promise.resolve({ ok: true, json: async () => [] })
            })

            const result = await latestOpenJDK(21, "dataDir", "installer")
            expect(result).not.toBeNull()
            expect(result.id).toBe('j21.zip')
            expect(result.isInstaller).toBeFalsy() 
        })
    })

    describe('DownloadEngine Reporting', () => {
        it('should cap the number of filenames in error message (UI Fix)', async () => {
            const assets = Array.from({ length: 10 }, (_, i) => ({ 
                id: `file${i}.bin`, 
                url: 'http://err', 
                path: `file${i}.bin`,
                size: 100
            }))
            
            global.fetch = jest.fn().mockRejectedValue(new Error('Network Error'))
            ConfigManager.getP2POnlyMode.mockReturnValue(false)

            try {
                await downloadQueue(assets)
                throw new Error('Should have thrown')
            } catch (e) {
                expect(e.message).toContain('file0.bin, file1.bin, file2.bin, file3.bin, file4.bin')
                expect(e.message).toContain('... и еще 5 файл(ов)')
                expect(e.message).not.toContain('file9.bin')
            }
        })
    })
})
