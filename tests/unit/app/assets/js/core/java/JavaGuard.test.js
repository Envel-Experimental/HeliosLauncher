const { latestOpenJDK } = require('@app/assets/js/core/java/JavaGuard')

// Mock Dependencies
jest.mock('@app/assets/js/core/java/JavaUtils', () => ({
    Platform: { WIN32: 'win32' },
    javaExecFromRoot: jest.fn(p => p),
    ensureJavaDirIsRoot: jest.fn(p => p)
}))

jest.mock('@network/config', () => ({
    MOJANG_MIRRORS: [
        {
            name: 'Test Mirror',
            java_manifest: 'https://test.mirror/java/manifest.json'
        }
    ]
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

jest.mock('@app/assets/js/core/dl/Asset', () => ({
    HashAlgo: { SHA1: 'sha1', SHA256: 'sha256' }
}))

jest.mock('@app/assets/js/core/common/DistributionClasses', () => ({
    JdkDistribution: { TEMURIN: 'temurin', CORRETTO: 'corretto' }
}))

describe('JavaGuard', () => {
describe('JavaGuard', () => {
    let latestOpenJDK
    const originalPlatform = process.platform

    beforeEach(() => {
        jest.resetModules()
        jest.clearAllMocks()
        global.fetch = jest.fn()
        Object.defineProperty(process, 'platform', { value: 'win32' })
        Object.defineProperty(process, 'arch', { value: 'x64' })
    })

    afterAll(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('should prioritize mirrors over official sources', async () => {
        const mirrorUrl = 'https://mirror.test/java/manifest.json'
        require('@network/config').MOJANG_MIRRORS = [{
            name: 'Test Mirror',
            java_manifest: mirrorUrl
        }]
        const { latestOpenJDK } = require('@app/assets/js/core/java/JavaGuard')

        // 1. Mirror call (success)
        global.fetch = jest.fn((url) => {
            if (url === mirrorUrl) {
                const data = {
                    windows: {
                        x64: {
                            "21": {
                                url: 'https://test.mirror/java21.zip',
                                size: 100,
                                name: 'java21.zip',
                                sha1: 'hash'
                            }
                        }
                    }
                }
                return Promise.resolve({
                    ok: true,
                    arrayBuffer: async () => Buffer.from(JSON.stringify(data)),
                    json: async () => data
                })
            }
            return Promise.resolve({ ok: false })
        })

        const result = await latestOpenJDK(21, 'dataDir', null)

        expect(result.url).toBe('https://test.mirror/java21.zip')
        expect(global.fetch).toHaveBeenCalledWith(mirrorUrl, expect.anything())
        // Since we use Promise.any, official sources are also queried in parallel.
        expect(global.fetch).toHaveBeenCalled()
    })

    it('should fallback to official sources if mirror fails', async () => {
        const mirrorUrl = 'https://mirror.test/java/manifest.json'
        require('@network/config').MOJANG_MIRRORS = [{
            name: 'Test Mirror',
            java_manifest: mirrorUrl
        }]
        const { latestOpenJDK } = require('@app/assets/js/core/java/JavaGuard')

        global.fetch = jest.fn((url) => {
            if (url === mirrorUrl) return Promise.resolve({ ok: false })
            if (url.includes('api.github.com')) return Promise.resolve({ ok: false })
            if (url.includes('api.adoptium.net')) {
                const data = [
                    {
                        version: { major: 21 },
                        binary: {
                            os: 'windows',
                            image_type: 'jdk',
                            architecture: 'x64',
                            package: {
                                link: 'https://adoptium.net/jdk21.zip',
                                size: 200,
                                name: 'jdk21.zip',
                                checksum: 'hash256'
                            }
                        }
                    }
                ]
                return Promise.resolve({
                    ok: true,
                    arrayBuffer: async () => Buffer.from(JSON.stringify(data)),
                    json: async () => data
                })
            }
            return Promise.resolve({ ok: false })
        })

        const result = await latestOpenJDK(21, 'dataDir', null)

        expect(result).not.toBeNull()
        expect(result.url).toBe('https://adoptium.net/jdk21.zip')
        expect(global.fetch).toHaveBeenCalledWith(mirrorUrl, expect.anything())
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('api.adoptium.net'), expect.anything())
    })

    it('should return null if no sources have the requested version', async () => {
        require('@network/config').MOJANG_MIRRORS = []
        const { latestOpenJDK } = require('@app/assets/js/core/java/JavaGuard')

        global.fetch = jest.fn(() => {
            const data = []
            return Promise.resolve({
                ok: true,
                arrayBuffer: async () => Buffer.from(JSON.stringify(data)),
                json: async () => data
            })
        })

        const result = await latestOpenJDK(21, 'dataDir', null)

        expect(result).toBeNull()
    })
})
})
