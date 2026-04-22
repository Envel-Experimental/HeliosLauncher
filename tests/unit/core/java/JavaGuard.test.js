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

// Mock JavaUtils
jest.mock('../../../../app/assets/js/core/java/JavaUtils', () => ({
    Platform: { WIN32: 'win32', DARWIN: 'darwin', LINUX: 'linux' },
    javaExecFromRoot: jest.fn(p => p),
    ensureJavaDirIsRoot: jest.fn(p => p)
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

describe('JavaGuard', () => {
    
    beforeEach(() => {
        jest.clearAllMocks()
        global.fetch.mockReset()
    })

    describe('latestOpenJDK', () => {
        it('should resolve from mirror if faster', async () => {
            const MirrorManager = require('../../../../network/MirrorManager')
            MirrorManager.getSortedMirrors.mockReturnValue([{
                name: 'Fast Mirror',
                java_manifest: 'http://fast/manifest.json'
            }])

            const mockManifest = { windows: { x64: { '17': { url: 'http://fast/java', size: 100, name: 'java17', sha1: 'abc' } } } }
            
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
                            os: 'windows',
                            image_type: 'jdk',
                            architecture: 'x64',
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
                cb(null, { stdout: '', stderr: '    java.version = 17.0.1\n    java.vendor = Oracle\n    sun.arch.data.model = 64' })
            })

            const result = await JavaGuard.validateSelectedJvm('/path/to/java', '>=17')
            expect(result).toBeDefined()
            expect(result.path).toBe('/path/to/java')
        })
    })
})
