// Test suite for ProcessBuilder
describe('ProcessBuilder', () => {
    // Mocks for dependencies
    let mockChildProcess
    let mockFsExtra
    let mockHeliosCore
    let mockConfigManager // Will be assigned the object in beforeEach, but jest.mock uses the module-level one
    let mockPreloader
    let mockPath
    let mockOs
    let mockCrypto

    // Mock helper modules to simplify ProcessBuilder tests
    // These need to be at the top level for Jest to hoist them.
    jest.mock('../../../../app/assets/js/processbuilder/liteloader', () => ({
        setupLiteLoader: jest.fn(),
    }))
    const mockModConfig = { // Store the mock object to reset/assert calls if needed
        resolveModConfiguration: jest.fn().mockReturnValue({ fMods: [], lMods: [] }),
        constructJSONModList: jest.fn(),
        constructModList: jest.fn().mockReturnValue([]), // For 1.13+
    }
    jest.mock('../../../../app/assets/js/processbuilder/modConfig', () => mockModConfig)

    const mockJvmArgs = { // Store the mock object
        constructJVMArguments: jest.fn().mockReturnValue(['-Xmx1G', 'net.minecraft.client.main.Main']), // Essential args
    }
    jest.mock('../../../../app/assets/js/processbuilder/jvmArgs', () => mockJvmArgs)


    // Actual ProcessBuilder class
    let ProcessBuilder

    beforeEach(() => {
        // Reset modules before each test to ensure clean state
        jest.resetModules()

        // Mock child_process
        const mockSpawnInstance = {
            stdout: { on: jest.fn(), setEncoding: jest.fn() },
            stderr: { on: jest.fn(), setEncoding: jest.fn() },
            on: jest.fn((event, callback) => {
                if (event === 'close') {
                    // Store the callback but don't call it immediately by default
                    // It can be triggered manually in tests if needed.
                }
            }),
            unref: jest.fn(),
        }
        mockChildProcess = {
            spawn: jest.fn().mockReturnValue(mockSpawnInstance),
        }
        jest.mock('child_process', () => mockChildProcess)

        // Mock fs-extra
        mockFsExtra = {
            ensureDirSync: jest.fn(),
            remove: jest.fn((path, callback) => callback(null)), // Simulate successful removal
            writeFileSync: jest.fn(), // Added writeFileSync
            // Add other fs-extra functions if ProcessBuilder uses them directly
        }
        jest.mock('fs-extra', () => mockFsExtra)

        // Mock helios-core
        mockHeliosCore = {
            LoggerUtil: {
                getLogger: jest.fn().mockReturnValue({
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(), // Ensure error method is mocked
                }),
            },
            mcVersionAtLeast: jest.fn().mockReturnValue(false), // Default to pre-1.13
            // Add other helios-core functions if ProcessBuilder uses them
        }
        jest.mock('helios-core', () => mockHeliosCore)

        // Mock ConfigManager - Focus on functions directly used by ProcessBuilder for its own logic
        // or for passing essential data to direct collaborators.
        mockConfigManager = {
            getInstanceDirectory: jest.fn().mockReturnValue('/test/instance'),
            getCommonDirectory: jest.fn().mockReturnValue('/test/common'),
            getTempNativeFolder: jest.fn().mockReturnValue('natives'), // Used for tempNativePath generation
            getJavaExecutable: jest.fn().mockReturnValue('java'), // Essential for spawn
            getLaunchDetached: jest.fn().mockReturnValue(false), // For child.unref()
            getModConfiguration: jest.fn().mockReturnValue({ mods: {} }), // Input to resolveModConfiguration
            // Functions like getMaxRAM, getMinRAM, getJVMOptions, getAutoConnect, getFullscreen
            // are used deeper within jvmArgs.js. For processbuilder.spec.js, we'll mock constructJVMArguments itself.
        }
        jest.mock('../../../../app/assets/js/configmanager', () => mockConfigManager)

        // Mock preloader (for sendToSentry)
        mockPreloader = {
            sendToSentry: jest.fn(),
        }
        jest.mock('../../../../app/assets/js/preloader', () => mockPreloader)

        // Mock path
        mockPath = {
            join: jest.fn((...args) => args.join('/')), // Simple join mock
            // Add other path functions if needed
        }
        jest.mock('path', () => mockPath)

        // Mock os
        mockOs = {
            tmpdir: jest.fn().mockReturnValue('/tmp'),
            // Add other os functions if needed
        }
        jest.mock('os', () => mockOs)

        // Mock crypto
        mockCrypto = {
            pseudoRandomBytes: jest.fn().mockReturnValue({
                toString: jest.fn().mockReturnValue('randomhex'),
            }),
        }
        jest.mock('crypto', () => mockCrypto)

        // Mock global UI functions used in ProcessBuilder for error display (if any)
        global.Lang = {
            queryJS: jest.fn(key => key), // Return key itself for simplicity
        }
        global.setOverlayContent = jest.fn()
        global.setOverlayHandler = jest.fn()
        global.setDismissHandler = jest.fn()
        global.toggleOverlay = jest.fn()


        // Dynamically require ProcessBuilder after mocks are set up
        ProcessBuilder = require('../../../../app/assets/js/processbuilder')
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    const createBasicDistroServer = () => ({
        rawServer: {
            id: 'testServer',
            minecraftVersion: '1.12.2', // Default to pre-1.13 for base tests
        },
        modules: [], // Moved modules here, as accessed directly by builder.server.modules
        // Add other properties if ProcessBuilder uses them
    })

    const createAuthUser = () => ({
        // Properties used by ProcessBuilder or its dependencies for constructing args
        uuid: 'test-uuid',
        accessToken: 'test-token',
        selectedProfile: {
            name: 'TestUser',
        }
    })

    it('should be defined', () => {
        expect(ProcessBuilder).toBeDefined()
    })

    it('constructor should initialize properties correctly', () => {
        const distroServer = createBasicDistroServer()
        const authUser = createAuthUser()
        const launcherVersion = '1.0.0'
        // Provide basic structure for vanillaManifest to avoid errors in deeper calls
        const vanillaManifest = {
            libraries: [],
            arguments: { jvm: [] },
            mainClass: 'net.minecraft.client.main.Main', // Example main class
            minecraftArguments: '', // Example
            assets: '', // Example
            id: '1.12.2' // Example version id
        }
        const modManifest = { arguments: {}, minecraftArguments: '' } // Basic structure for modManifest, added minecraftArguments

        const builder = new ProcessBuilder(distroServer, vanillaManifest, modManifest, authUser, launcherVersion)

        expect(mockConfigManager.getInstanceDirectory).toHaveBeenCalled()
        expect(mockPath.join).toHaveBeenCalledWith('/test/instance', 'testServer')
        // Access properties via builder.config.get... methods
        expect(builder.config.getGameDirectory()).toBe('/test/instance/testServer')
        expect(builder.config.getCommonDirectory()).toBe('/test/common')
        expect(builder.config.getServer()).toBe(distroServer)
        expect(builder.config.getAuthUser()).toBe(authUser)
        expect(builder.config.getLauncherVersion()).toBe(launcherVersion)
        expect(builder.config.getForgeModListFile()).toBe('/test/instance/testServer/forgeMods.list')
        expect(builder.config.getFmlDirectory()).toBe('/test/instance/testServer/forgeModList.json')
        expect(builder.config.getLiteLoaderDirectory()).toBe('/test/instance/testServer/liteloaderModList.json')
        expect(builder.config.getLibraryPath()).toBe('/test/common/libraries')
    })

    describe('build method', () => {
        let distroServer
        let authUser
        let builder

        beforeEach(() => {
            distroServer = createBasicDistroServer()
            authUser = createAuthUser()
            // Reset mcVersionAtLeast for each build test if necessary
            mockHeliosCore.mcVersionAtLeast.mockReturnValue(false)
            const vanillaManifest = {
                libraries: [],
                arguments: { jvm: [] },
                mainClass: 'net.minecraft.client.main.Main',
                minecraftArguments: '',
                assets: '',
                id: '1.12.2'
            }
            const modManifest = { arguments: {}, minecraftArguments: '' } // Added minecraftArguments
            builder = new ProcessBuilder(distroServer, vanillaManifest, modManifest, authUser, '1.0.0')
        })

        it('should ensure game directory exists', () => {
            builder.build()
            expect(mockFsExtra.ensureDirSync).toHaveBeenCalledWith(builder.config.getGameDirectory())
        })

        it('should generate a temporary native path', () => {
            builder.build()
            expect(mockOs.tmpdir).toHaveBeenCalled()
            expect(mockConfigManager.getTempNativeFolder).toHaveBeenCalled()
            expect(mockCrypto.pseudoRandomBytes).toHaveBeenCalledWith(16)
            expect(mockPath.join).toHaveBeenCalledWith('/tmp', 'natives', 'randomhex')
        })

        it('should spawn a child process with correct java executable and arguments', () => {
            mockConfigManager.getJavaExecutable.mockReturnValue('path/to/java')
            builder.build()
            expect(mockChildProcess.spawn).toHaveBeenCalled()
            const spawnArgs = mockChildProcess.spawn.mock.calls[0]
            expect(spawnArgs[0]).toBe('path/to/java')
            expect(Array.isArray(spawnArgs[1])).toBe(true) // JVM arguments array
            expect(spawnArgs[2]).toEqual({ // Options
                cwd: builder.config.getGameDirectory(), // Use getter
                detached: false, // Default from mockConfigManager
            })
        })

        it('should handle detached launch option', () => {
            mockConfigManager.getLaunchDetached.mockReturnValue(true)
            const childMock = { // Re-mock child process for this specific test
                stdout: { on: jest.fn(), setEncoding: jest.fn() },
                stderr: { on: jest.fn(), setEncoding: jest.fn() },
                on: jest.fn(),
                unref: jest.fn(),
            }
            mockChildProcess.spawn.mockReturnValue(childMock)

            builder.build()
            expect(childMock.unref).toHaveBeenCalled()
        })

        it('should set up stdout and stderr listeners', () => {
            builder.build() // Call build first
            const childMock = mockChildProcess.spawn.mock.results[0].value // Then get the mock
            expect(childMock.stdout.setEncoding).toHaveBeenCalledWith('utf8')
            expect(childMock.stderr.setEncoding).toHaveBeenCalledWith('utf8')
            expect(childMock.stdout.on).toHaveBeenCalledWith('data', expect.any(Function))
            expect(childMock.stderr.on).toHaveBeenCalledWith('data', expect.any(Function))
        })

        it('should set up a close listener for the child process', () => {
            builder.build() // Call build first
            const childMock = mockChildProcess.spawn.mock.results[0].value // Then get the mock
            expect(childMock.on).toHaveBeenCalledWith('close', expect.any(Function))
        })

        it('should remove temporary native path on process close', () => {
            // Capture the 'close' callback
            let closeCallback
            mockChildProcess.spawn.mockReturnValue({
                stdout: { on: jest.fn(), setEncoding: jest.fn() },
                stderr: { on: jest.fn(), setEncoding: jest.fn() },
                on: (event, callback) => {
                    if (event === 'close') {
                        closeCallback = callback
                    }
                },
                unref: jest.fn(),
            })

            builder.build()
            expect(closeCallback).toBeDefined()

            // const tempNativePath = mockPath.join(mockOs.tmpdir(), mockConfigManager.getTempNativeFolder(), mockCrypto.pseudoRandomBytes(16).toString('hex')); // Unused
            closeCallback(0, null) // Simulate process exit with code 0

            expect(mockFsExtra.remove).toHaveBeenCalledWith(expect.stringContaining('/tmp/natives/randomhex'), expect.any(Function))
        })

        it('should display error overlay and send to Sentry if process exits with non-zero code', () => {
            // Capture the 'close' callback
            let closeCallback
            mockChildProcess.spawn.mockReturnValue({
                stdout: { on: jest.fn(), setEncoding: jest.fn() },
                stderr: { on: jest.fn(), setEncoding: jest.fn() },
                on: (event, callback) => {
                    if (event === 'close') {
                        closeCallback = callback
                    }
                },
                unref: jest.fn(),
            })

            builder.build()
            expect(closeCallback).toBeDefined()

            closeCallback(1, null) // Simulate process exit with code 1

            expect(mockPreloader.sendToSentry).toHaveBeenCalledWith('Minecraft process exited with code: 1', 'error')
            expect(global.setOverlayContent).toHaveBeenCalledWith(
                'processbuilder.exit.exitErrorHeader',
                'processbuilder.exit.message' + 1,
                'uibinder.startup.closeButton'
            )
            expect(global.setOverlayHandler).toHaveBeenCalled()
            expect(global.setDismissHandler).toHaveBeenCalled()
            expect(global.toggleOverlay).toHaveBeenCalledWith(true, true)
        })

        // Test for Minecraft 1.13+ specific logic
        it('should handle mod list construction for MC 1.13+', () => {
            distroServer.rawServer.minecraftVersion = '1.13'
            distroServer.rawServer.minecraftVersion = '1.13'

            jest.resetModules() // Reset module cache

            // Mock helios-core specifically for this test context
            const localMcVersionAtLeastMock = jest.fn().mockImplementation((version, serverVersion) => {
                return serverVersion === '1.13' // Specific behavior for this test
            })

            // Mock for 'helios-core' to provide LoggerUtil
            jest.doMock('helios-core', () => ({
                LoggerUtil: {
                    getLogger: jest.fn().mockReturnValue({
                        info: jest.fn(), warn: jest.fn(), error: jest.fn(),
                    }),
                },
            }))

            // Mock for 'helios-core/common' to provide mcVersionAtLeast
            jest.doMock('helios-core/common', () => ({
                mcVersionAtLeast: localMcVersionAtLeastMock,
                isLibraryCompatible: jest.fn().mockReturnValue(true),
                getMojangOS: jest.fn().mockReturnValue('linux'),
            }))

            ProcessBuilder = require('../../../../app/assets/js/processbuilder')

            const vanillaManifest = { libraries: [], arguments: { jvm: [] }, mainClass: 'net.minecraft.client.main.Main', minecraftArguments: '', assets: '', id: '1.13'}
            const modManifest = { arguments: {}, minecraftArguments: '' }
            builder = new ProcessBuilder(distroServer, vanillaManifest, modManifest, authUser, '1.0.0')
            builder.build()

            expect(localMcVersionAtLeastMock).toHaveBeenCalledWith('1.13', '1.13')
        })

        // Test for LiteLoader
        it('should setup LiteLoader if present', () => {
            distroServer.modules = [{ rawModule: { type: 'litesupport' } }]
            // const mockLiteLoader = require('../../../../app/assets/js/processbuilder/liteloader'); // Unused variable
            jest.mock('../../../../app/assets/js/processbuilder/liteloader', () => ({ // This mock is already at top-level, re-mocking here is not standard
                setupLiteLoader: jest.fn(),
            }))

            ProcessBuilder = require('../../../../app/assets/js/processbuilder')
            const vanillaManifest = { libraries: [], arguments: { jvm: [] }, mainClass: 'net.minecraft.client.main.Main', minecraftArguments: '', assets: '', id: '1.12.2'}
            const modManifest = { arguments: {}, minecraftArguments: '' }
            builder = new ProcessBuilder(distroServer, vanillaManifest, modManifest, authUser, '1.0.0')
            builder.build()
            expect(jest.requireMock('../../../../app/assets/js/processbuilder/liteloader').setupLiteLoader).toHaveBeenCalledWith(builder.config)
        })

        // Test for Fabric
        it('should identify Fabric loader', () => {
            const { Type } = require('helios-distribution-types')

            distroServer.modules = [{ rawModule: { type: Type.Fabric } }]

            const vanillaManifest = { libraries: [], arguments: { jvm: [] }, mainClass: 'net.minecraft.client.main.Main', minecraftArguments: '', assets: '', id: '1.12.2'}
            const modManifest = { arguments: {}, minecraftArguments: '' }
            builder = new ProcessBuilder(distroServer, vanillaManifest, modManifest, authUser, '1.0.0')

            builder.build()
            expect(builder.config.isUsingFabricLoader()).toBe(true)
        })

    })
})
