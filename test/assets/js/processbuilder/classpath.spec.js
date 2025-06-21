const path = require('path')
const { Type } = require('helios-distribution-types')
const ProcessConfiguration = require('../../../../app/assets/js/processbuilder/modules/config')
const ConfigManager = require('../../../../app/assets/js/configmanager') // For getInstanceDirectory, getCommonDirectory used by ProcessConfiguration

// Import the module to be tested. Jest will use __mocks__ for its local dependencies if they exist.
const { classpathArg } = require('../../../../app/assets/js/processbuilder/classpath')

// Mock external dependencies of classpath.js
jest.mock('adm-zip', () => {
    return jest.fn().mockImplementation(function(zipPath) {
        return {
            getEntries: jest.fn(() => [{ entryName: 'test.dll', getData: () => Buffer.from('dummydata') }]),
            extractEntryTo: jest.fn()
        }
    })
})

jest.mock('fs-extra', () => ({
    ensureDirSync: jest.fn(),
    // Make writeFile a synchronous mock for simplicity in these tests, or ensure test waits if it were async.
    writeFile: jest.fn((path, data, cb) => { if (typeof cb === 'function') cb() }),
    // If classpath.js uses other fs-extra methods like existsSync, mock them here.
    existsSync: jest.fn().mockReturnValue(true), // Default to true for most tests
}))

// Mock helios-core/common as it's a direct dependency
// eslint-disable-next-line no-unused-vars
const { isLibraryCompatible, getMojangOS, mcVersionAtLeast } = require('helios-core/common')
jest.mock('helios-core/common', () => ({
    isLibraryCompatible: jest.fn((rules, natives) => !rules),
    getMojangOS: jest.fn(() => (process.platform === 'darwin' ? 'osx' : (process.platform === 'win32' ? 'windows' : 'linux'))),
    mcVersionAtLeast: jest.fn() // Will be reset in beforeEach
}))

// Manual mock for './modules/logging' as it's a local dependency of classpath.js
jest.mock('../../../../app/assets/js/processbuilder/modules/logging', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}))


describe('Process Builder Classpath Logic (classpath.js)', () => {
    let mockConfigInstance
    let dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion

    let originalCMGetInstanceDirectory
    let originalCMGetCommonDirectory

    beforeEach(() => {
        // Store and mock ConfigManager functions needed by ProcessConfiguration constructor
        originalCMGetInstanceDirectory = ConfigManager.getInstanceDirectory
        originalCMGetCommonDirectory = ConfigManager.getCommonDirectory
        ConfigManager.getInstanceDirectory = jest.fn().mockReturnValue('/test/instances')
        ConfigManager.getCommonDirectory = jest.fn().mockReturnValue('/test/common')

        // Reset external dependency mocks
        require('fs-extra').ensureDirSync.mockClear()
        require('fs-extra').writeFile.mockClear()
        require('fs-extra').existsSync.mockClear().mockReturnValue(true) // Default
        require('adm-zip').mockClear()
        isLibraryCompatible.mockClear().mockImplementation((rules, natives) => !rules) // Reset to default simple mock
        mcVersionAtLeast.mockClear().mockImplementation((current, target) => parseFloat(String(current)) >= parseFloat(String(target)))


        dummyDistro = {
            rawServer: { id: 'testServer', minecraftVersion: '1.12.2' },
            modules: []
        }
        dummyVanillaManifest = {
            id: '1.12.2',
            libraries: [
                { name: 'com.mojang:patchy:1.1', downloads: { artifact: { path: 'com.mojang/patchy/1.1/patchy-1.1.jar' } } },
                {
                    name: 'org.lwjgl.lwjgl:lwjgl_util:2.9.4-nightly-20150209',
                    natives: { linux: 'natives-linux', osx: 'natives-osx', windows: 'natives-windows' },
                    extract: { exclude: ['META-INF/'] },
                    downloads: { classifiers: { 'natives-linux': { path: 'org/lwjgl/lwjgl/lwjgl_util/2.9.4-nightly-20150209/lwjgl_util-2.9.4-nightly-20150209-natives-linux.jar' } } }
                }
            ],
            arguments: {}, assets: '1.12.2', type: 'release'
        }
        dummyModManifest = { id: '1.12.2-forge-x.y.z', arguments: {}, minecraftArguments: '' }
        dummyAuthUser = { displayName: 'TestUser', uuid: 'test-uuid', accessToken: 'test-token', type: 'mojang' }
        dummyLauncherVersion = '1.0.0'

        mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion)
        mockConfigInstance.setUsingLiteLoader(false) // Default
        mockConfigInstance.setUsingFabricLoader(false) // Default
    })

    afterEach(() => {
        ConfigManager.getInstanceDirectory = originalCMGetInstanceDirectory
        ConfigManager.getCommonDirectory = originalCMGetCommonDirectory
        jest.clearAllMocks()
    })

    describe('classpathArg(config, mods, tempNativePath)', () => {
        it('should include version.jar for MC < 1.17', () => {
            dummyVanillaManifest.id = '1.12.2'
            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion)

            // Force the mock for this specific test case to ensure the condition is met
            mcVersionAtLeast.mockImplementation((targetRange, versionToTest) => {
                if (targetRange === '1.17' && versionToTest === '1.12.2') {
                    return false // 1.12.2 is NOT >= 1.17
                }
                // Fallback to a generic implementation if other calls are made
                const trParts = String(targetRange).split('.').map(Number)
                const vtParts = String(versionToTest).split('.').map(Number)
                for (let i = 0; i < Math.max(trParts.length, vtParts.length); i++) {
                    const t = trParts[i] || 0
                    const v = vtParts[i] || 0
                    if (v < t) return false
                    if (v > t) return true
                }
                return true
            })

            const result = classpathArg(mockConfigInstance, [], '/tmp/natives')
            const versionJarPath = path.join(mockConfigInstance.getCommonDirectory(), 'versions', mockConfigInstance.getVanillaManifest().id, `${mockConfigInstance.getVanillaManifest().id}.jar`)
            expect(result).toContain(versionJarPath)
        })

        it('should NOT include version.jar for MC >= 1.17 if not Fabric', () => {
            dummyVanillaManifest.id = '1.17'
            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion)
            mockConfigInstance.setUsingFabricLoader(false)

            const result = classpathArg(mockConfigInstance, [], '/tmp/natives')
            const versionJarPath = path.join(mockConfigInstance.getCommonDirectory(), 'versions', mockConfigInstance.getVanillaManifest().id, `${mockConfigInstance.getVanillaManifest().id}.jar`)
            expect(result).not.toContain(versionJarPath)
        })

        it('should include version.jar for MC >= 1.17 if Fabric IS used', () => {
            dummyVanillaManifest.id = '1.17'
            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion)
            mockConfigInstance.setUsingFabricLoader(true)

            const result = classpathArg(mockConfigInstance, [], '/tmp/natives')
            const versionJarPath = path.join(mockConfigInstance.getCommonDirectory(), 'versions', mockConfigInstance.getVanillaManifest().id, `${mockConfigInstance.getVanillaManifest().id}.jar`)
            expect(result).toContain(versionJarPath)
        })

        it('should include LiteLoader path if usingLiteLoader is true', () => {
            mockConfigInstance.setUsingLiteLoader(true, '/path/to/liteloader.jar')
            const result = classpathArg(mockConfigInstance, [], '/tmp/natives')
            expect(result).toContain('/path/to/liteloader.jar')
        })

        it('should include resolved Mojang libraries', () => {
            const result = classpathArg(mockConfigInstance, [], '/tmp/natives')
            const expectedMojangLibPath = path.join(mockConfigInstance.getLibraryPath(), 'com.mojang/patchy/1.1/patchy-1.1.jar')
            expect(result).toContain(expectedMojangLibPath)
        })

        it('should include resolved server libraries', () => {
            dummyDistro.modules = [
                {
                    rawModule: { type: Type.Library, classpath: true }, // Ensure classpath is true or undefined
                    getVersionlessMavenIdentifier: () => 'com.example:serverlib:1.0',
                    getPath: () => '/libs/serverlib.jar',
                    subModules: []
                }
            ]
            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion)
            const result = classpathArg(mockConfigInstance, [], '/tmp/natives')
            expect(result).toContain('/libs/serverlib.jar')
        })

        it('should correctly process classpath list (remove beyond .jar in _processClassPathList)', () => {
            // This test relies on the internal _processClassPathList modifying the array.
            // We'll add a library path that needs trimming.
            const originalLibs = dummyVanillaManifest.libraries
            dummyVanillaManifest.libraries = [
                ...originalLibs,
                {
                    name: 'com.example:funkyjar:1.0',
                    downloads: { artifact: { path: 'com.example/funkyjar/1.0/funkyjar-1.0.jarEXTRASTUFF' } }
                }
            ]
            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion)

            const result = classpathArg(mockConfigInstance, [], '/tmp/natives')
            const expectedPath = path.join(mockConfigInstance.getLibraryPath(), 'com.example/funkyjar/1.0/funkyjar-1.0.jar')
            expect(result).toContain(expectedPath) // Check that it's trimmed

            // Restore original libs for other tests if vanillaManifest is not deep cloned in beforeEach
            dummyVanillaManifest.libraries = originalLibs
        })

        it('should extract native libraries', () => {
            const tempNativePath = '/tmp/natives_extract_test'
            // Ensure AdmZip mock is clear for call count
            require('adm-zip').mockClear()
            require('fs-extra').writeFile.mockClear()

            classpathArg(mockConfigInstance, [], tempNativePath)

            // Check if AdmZip was instantiated (implies a native library was processed)
            // This depends on the dummyVanillaManifest having a native library for the current OS mock
            // getMojangOS() returns 'linux' by default in this test setup if not darwin/win32
            // The dummy native is 'org.lwjgl.lwjgl:lwjgl_util...' which has a 'natives-linux'
            expect(require('adm-zip')).toHaveBeenCalled()
            // Check if fs.writeFile was called (implies extraction attempt)
            expect(require('fs-extra').writeFile).toHaveBeenCalled()
        })
    })
})
