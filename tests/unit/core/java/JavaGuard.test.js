// Mock modules first
jest.mock('child_process', () => ({
    exec: jest.fn(),
    execFile: jest.fn()
}))

jest.mock('fs/promises', () => ({
    access: jest.fn().mockResolvedValue(),
    readdir: jest.fn().mockResolvedValue([]),
    mkdir: jest.fn().mockResolvedValue(),
    rm: jest.fn().mockResolvedValue(),
    readFile: jest.fn().mockResolvedValue('')
}))

// Mock global fetch
global.fetch = jest.fn()

const path = require('path')
const fs = require('fs/promises')
const child_process = require('child_process')

// Mock LoggerUtil
jest.mock('../../../../app/assets/js/core/util/LoggerUtil', () => ({
    LoggerUtil: {
        getLogger: jest.fn().mockReturnValue({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        })
    }
}))

// resolveNativeArch is tested separately and mocked here for isolation.
// The mock is a factory so individual tests can override it via mockReturnValue.
const mockResolveNativeArch = jest.fn(() => process.arch)

jest.mock('../../../../app/assets/js/core/java/JavaUtils', () => ({
    Platform: { WIN32: 'win32', DARWIN: 'darwin', LINUX: 'linux' },
    javaExecFromRoot: jest.fn(p => p),
    ensureJavaDirIsRoot: jest.fn(p => p),
    resolveNativeArch: mockResolveNativeArch
}))

// Mock MirrorManager (4 levels up to root)
jest.mock('../../../../network/MirrorManager', () => ({
    initialized: true,
    getSortedMirrors: jest.fn().mockReturnValue([])
}))

// Mock network config (4 levels up to root)
jest.mock('../../../../network/config', () => ({
    MOJANG_MIRRORS: [],
    DISTRO_PUB_KEYS: []
}))

// Mock SignatureUtils
jest.mock('../../../../app/assets/js/core/util/SignatureUtils', () => ({
    verifyDistribution: jest.fn().mockReturnValue(true)
}))

// Mock FileUtils
jest.mock('../../../../app/assets/js/core/common/FileUtils', () => ({
    extractZip: jest.fn(),
    extractTarGz: jest.fn()
}))

const JavaGuard = require('../../../../app/assets/js/core/java/JavaGuard')
const JavaUtils = require('../../../../app/assets/js/core/java/JavaUtils')

describe('JavaGuard', () => {

    beforeEach(() => {
        jest.clearAllMocks()
        global.fetch.mockReset()
        // Default: behave like the real process.arch
        mockResolveNativeArch.mockReturnValue(process.arch)
    })

    describe('latestOpenJDK', () => {
        it('should resolve from mirror if faster', async () => {
            const MirrorManager = require('../../../../network/MirrorManager')
            MirrorManager.getSortedMirrors.mockReturnValue([{
                name: 'Fast Mirror',
                java_manifest: 'http://fast/manifest.json'
            }])

            const currentPlatform = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'mac' : process.platform)
            const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
            const mockManifest = { [currentPlatform]: { [arch]: { '17': { url: 'http://fast/java', size: 100, name: 'java17', sha1: 'abc' } } } }
            
            global.fetch.mockResolvedValueOnce({
                ok: true,
                arrayBuffer: () => Promise.resolve(Buffer.from(JSON.stringify(mockManifest)))
            })

            const result = await JavaGuard.latestOpenJDK(17, '/data', null)
            expect(result).toBeDefined()
            expect(result.url).toBe('http://fast/java')
        })

        it('should fallback to official if mirrors fail', async () => {
            const MirrorManager = require('../../../../network/MirrorManager')
            MirrorManager.getSortedMirrors.mockReturnValue([{
                name: 'Bad Mirror',
                java_manifest: 'http://bad/manifest.json'
            }])

            global.fetch.mockImplementation((url) => {
                if (url.includes('bad')) return Promise.resolve({ ok: false })
                if (url.includes('adoptium')) return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([{
                        version: { major: 17 },
                        binary: {
                            os: process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'mac' : process.platform),
                        image_type: 'jdk',
                            architecture: process.arch === 'arm64' ? 'aarch64' : 'x64',
                            package: { link: 'http://official/java', size: 200, name: 'java17-official.zip', checksum: 'def' }
                        }
                    }])
                })
                return Promise.reject(new Error('Not found'))
            })

            const result = await JavaGuard.latestOpenJDK(17, '/data', null)
            expect(result).toBeDefined()
            expect(result.url).toBe('http://official/java')
        })

        it('should request aarch64 Java from mirror on Windows ARM64 (x64 Electron emulation)', async () => {
            // Simulate Windows ARM64: process.arch = 'x64' (emulated), but native = arm64
            mockResolveNativeArch.mockReturnValue('arm64')

            const MirrorManager = require('../../../../network/MirrorManager')
            MirrorManager.getSortedMirrors.mockReturnValue([{
                name: 'ARM Mirror',
                java_manifest: 'http://arm-mirror/manifest.json'
            }])

            const platform = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'mac' : process.platform)
            const mockManifest = {
                [platform]: {
                    aarch64: {
                        '21': { url: 'http://arm-mirror/java-arm64', size: 500, name: 'jdk21-arm64.zip', sha1: 'arm64sha' }
                    },
                    x64: {
                        '21': { url: 'http://arm-mirror/java-x64', size: 500, name: 'jdk21-x64.zip', sha1: 'x64sha' }
                    }
                }
            }

            global.fetch.mockResolvedValueOnce({
                ok: true,
                arrayBuffer: () => Promise.resolve(Buffer.from(JSON.stringify(mockManifest)))
            })

            const result = await JavaGuard.latestOpenJDK(21, '/data', null)
            expect(result).toBeDefined()
            // Must download ARM64 JDK, not x64
            expect(result.url).toBe('http://arm-mirror/java-arm64')
            expect(result.id).toBe('jdk21-arm64.zip')
        })

        it('should request aarch64 Java from Adoptium on Windows ARM64', async () => {
            mockResolveNativeArch.mockReturnValue('arm64')

            const MirrorManager = require('../../../../network/MirrorManager')
            MirrorManager.getSortedMirrors.mockReturnValue([]) // no mirrors

            const sanitizedOS = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'mac' : process.platform)

            global.fetch.mockImplementation((url) => {
                if (url.includes('adoptium')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve([
                            // x64 entry — should NOT be picked
                            {
                                version: { major: 21 },
                                binary: {
                                    os: sanitizedOS,
                                    image_type: 'jdk',
                                    architecture: 'x64',
                                    package: { link: 'http://adoptium/java-x64', size: 300, name: 'jdk21-x64.zip', checksum: 'x64sum' }
                                }
                            },
                            // aarch64 entry — should be picked
                            {
                                version: { major: 21 },
                                binary: {
                                    os: sanitizedOS,
                                    image_type: 'jdk',
                                    architecture: 'aarch64',
                                    package: { link: 'http://adoptium/java-arm64', size: 280, name: 'jdk21-aarch64.zip', checksum: 'arm64sum' }
                                }
                            }
                        ])
                    })
                }
                // BellSoft NIK & GitHub GraalVM will fail → falls back to Adoptium
                return Promise.reject(new Error('Not found'))
            })

            const result = await JavaGuard.latestOpenJDK(21, '/data', 'temurin')
            expect(result).toBeDefined()
            expect(result.url).toBe('http://adoptium/java-arm64')
        })
    })

    describe('validateSelectedJvm', () => {
        it('should return null for empty path', async () => {
            const result = await JavaGuard.validateSelectedJvm('', '>=17')
            expect(result).toBeNull()
        })

        it('should validate path through settings', async () => {
            // fs.access is already mocked at top level
            fs.access.mockResolvedValueOnce()
            
            child_process.execFile.mockImplementation((file, args, opts, cb) => {
                const callback = typeof opts === 'function' ? opts : cb
                const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
                callback(null, '', `    java.version = 17.0.1\n    java.vendor = Oracle\n    sun.arch.data.model = 64\n    os.arch = ${arch}`)
            })

            const result = await JavaGuard.validateSelectedJvm('/path/to/java', '>=17')
            expect(result).toBeDefined()
            expect(result.path).toBe('/path/to/java')
        })

        it('should reject x64 JVM on ARM64 Windows host', async () => {
            // Native arch is arm64, but the JVM binary reports x64
            mockResolveNativeArch.mockReturnValue('arm64')
            fs.access.mockResolvedValueOnce()

            child_process.execFile.mockImplementation((file, args, opts, cb) => {
                const callback = typeof opts === 'function' ? opts : cb
                // x64 JVM — should be rejected on arm64 host
                callback(null, '', '    java.version = 21.0.1\n    java.vendor = Eclipse\n    sun.arch.data.model = 64\n    os.arch = x86_64')
            })

            const result = await JavaGuard.validateSelectedJvm('/path/to/x64/java', '>=17')
            expect(result).toBeNull()
        })

        it('should accept aarch64 JVM on ARM64 Windows host', async () => {
            mockResolveNativeArch.mockReturnValue('arm64')
            fs.access.mockResolvedValueOnce()

            child_process.execFile.mockImplementation((file, args, opts, cb) => {
                const callback = typeof opts === 'function' ? opts : cb
                callback(null, '', '    java.version = 21.0.1\n    java.vendor = Eclipse\n    sun.arch.data.model = 64\n    os.arch = aarch64')
            })

            const result = await JavaGuard.validateSelectedJvm('/path/to/arm64/java', '>=17')
            expect(result).toBeDefined()
            expect(result.path).toBe('/path/to/arm64/java')
        })
    })
})
