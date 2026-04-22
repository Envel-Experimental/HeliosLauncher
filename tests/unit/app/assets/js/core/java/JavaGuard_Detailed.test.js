const path = require('path')

describe('JavaGuard Detailed Tests', () => {
    let JavaGuard
    let fs
    let child_process
    let SignatureUtils
    let JavaUtils
    let MirrorManager

    beforeEach(() => {
        jest.resetModules()

        // Mock Dependencies
        jest.doMock('fs/promises', () => ({
            readFile: jest.fn(),
            access: jest.fn(),
            readdir: jest.fn(),
            mkdir: jest.fn()
        }))

        jest.doMock('child_process', () => ({
            exec: jest.fn(),
            execFile: jest.fn()
        }))

        jest.doMock('@core/java/JavaUtils', () => ({
            javaExecFromRoot: jest.fn((p) => path.join(p, 'bin', 'java.exe')),
            Platform: { WIN32: 'win32', DARWIN: 'darwin', LINUX: 'linux' }
        }))

        jest.doMock('@network/MirrorManager', () => ({
            getSortedMirrors: jest.fn().mockReturnValue([]),
            initialized: true
        }))

        jest.doMock('@network/config', () => ({
            MOJANG_MIRRORS: [],
            DISTRO_PUB_KEYS: []
        }))

        jest.doMock('@core/util/SignatureUtils', () => ({
            verifyDistribution: jest.fn().mockReturnValue(true)
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

        // Mock global fetch
        global.fetch = jest.fn()
        global.AbortController = class {
            constructor() { this.signal = {} }
            abort() {}
        }

        JavaGuard = require('@core/java/JavaGuard')
        fs = require('fs/promises')
        child_process = require('child_process')
        SignatureUtils = require('@core/util/SignatureUtils')
        JavaUtils = require('@core/java/JavaUtils')
        MirrorManager = require('@network/MirrorManager')
    })

    test('parseJavaRuntimeVersion should handle legacy and semver', () => {
        const legacy = JavaGuard.parseJavaRuntimeVersion('1.8.0_292-b10')
        expect(legacy).toEqual({ major: 8, minor: 0, patch: 292 })

        const semver = JavaGuard.parseJavaRuntimeVersion('17.0.1+12')
        expect(semver).toEqual({ major: 17, minor: 0, patch: 1 })
    })

    test('getHotSpotSettings should parse java output', async () => {
        // Output from java -XshowSettings:properties usually starts with 4 spaces for properties
        const mockStderr = '    java.version = 17.0.1\n    java.vendor = Oracle\n    sun.arch.data.model = 64\n    java.library.path = /lib1\n        /lib2'
        child_process.execFile.mockImplementation((file, args, opts, cb) => {
            const callback = typeof opts === 'function' ? opts : cb
            // Simulate promisify resolving to an object with stderr
            callback(null, { stdout: '', stderr: mockStderr })
        })
        fs.access.mockResolvedValue()

        const settings = await JavaGuard.getHotSpotSettings('/mock/java')
        
        expect(settings).not.toBeNull()
        expect(settings['java.version']).toBe('17.0.1')
        expect(settings['java.vendor']).toBe('Oracle')
        expect(settings['java.library.path']).toEqual(['/lib1', '/lib2'])
    })

    test('rankApplicableJvms should sort by version and type', () => {
        const jvms = [
            { semver: { major: 11, minor: 0, patch: 1 }, path: '/jdk-11' },
            { semver: { major: 17, minor: 0, patch: 1 }, path: '/jre-17' },
            { semver: { major: 17, minor: 0, patch: 1 }, path: '/jdk-17' },
            { semver: { major: 17, minor: 0, patch: 5 }, path: '/jre-17-u5' }
        ]

        JavaGuard.rankApplicableJvms(jvms)

        expect(jvms[0].semver.patch).toBe(5)
        expect(jvms[1].path).toBe('/jdk-17')
        expect(jvms[2].path).toBe('/jre-17')
        expect(jvms[3].semver.major).toBe(11)
    })

    test('latestOpenJDK should race between mirror and official', async () => {
        MirrorManager.getSortedMirrors.mockReturnValue([
            { name: 'TestMirror', java_manifest: 'http://mirror/java.json' }
        ])

        global.fetch.mockResolvedValueOnce({
            ok: true,
            arrayBuffer: () => Promise.resolve(Buffer.from(JSON.stringify({
                windows: { x64: { '17': { url: 'http://mirror/java17.zip', name: 'java17.zip', size: 100, sha1: 'hash' } } },
                linux: { x64: { '17': { url: 'http://mirror/java17.zip', name: 'java17.zip', size: 100, sha1: 'hash' } } },
                darwin: { x64: { '17': { url: 'http://mirror/java17.zip', name: 'java17.zip', size: 100, sha1: 'hash' } } }
            })))
        })

        jest.spyOn(JavaGuard, 'latestAdoptium').mockImplementation(() => new Promise(r => setTimeout(() => r({ url: 'http://official' }), 500)))

        const res = await JavaGuard.latestOpenJDK(17, '/data')

        expect(res).not.toBeNull()
        expect(res.url).toBe('http://mirror/java17.zip')
    })
})
