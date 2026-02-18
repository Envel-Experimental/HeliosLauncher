const LaunchArgumentBuilder = require('@app/assets/js/core/game/LaunchArgumentBuilder')
const ConfigManager = require('@app/assets/js/configmanager')
const FileUtils = require('@app/assets/js/core/common/FileUtils')
const { HashAlgo } = require('@app/assets/js/core/dl/Asset')
const path = require('path')

jest.mock('@app/assets/js/configmanager')
jest.mock('@app/assets/js/core/common/FileUtils')
jest.mock('fs/promises')
jest.mock('@app/assets/js/core/util/LoggerUtil', () => ({
    LoggerUtil: {
        getLogger: jest.fn(() => ({
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        }))
    }
}))

// Mock p-limit for dynamic import
jest.mock('p-limit', () => ({
    __esModule: true,
    default: jest.fn(() => (fn) => fn())
}))

describe('LaunchArgumentBuilder', () => {
    let builder
    const mockServer = {
        rawServer: {
            id: 'testServer',
            minecraftVersion: '1.12.2',
            autoconnect: false
        },
        hostname: 'localhost',
        port: 25565
    }
    const vanillaManifest = {
        id: '1.12.2',
        assets: '1.12',
        type: 'release',
        libraries: [],
        arguments: {
            jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
            game: ['--username', '${auth_player_name}']
        }
    }
    const modManifest = {
        mainClass: 'net.minecraft.launchwrapper.Launch',
        minecraftArguments: '--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userType ${user_type} --tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker --versionType Forge',
        arguments: {
            jvm: [],
            game: []
        }
    }
    const authUser = {
        displayName: 'TestPlayer',
        uuid: 'uuid-123',
        accessToken: 'token-abc',
        type: 'mojang'
    }
    const launcherVersion = '1.0.0'
    const gameDir = 'game'
    const commonDir = 'common'

    beforeEach(() => {
        jest.clearAllMocks()
        // Deep clone to avoid state pollution between tests
        const serverClone = JSON.parse(JSON.stringify(mockServer))
        const manifestClone = JSON.parse(JSON.stringify(vanillaManifest))
        const modClone = JSON.parse(JSON.stringify(modManifest))

        builder = new LaunchArgumentBuilder(serverClone, manifestClone, modClone, authUser, launcherVersion, gameDir, commonDir)

        ConfigManager.getMaxRAM.mockReturnValue('2G')
        ConfigManager.getMinRAM.mockReturnValue('1G')
        ConfigManager.getJVMOptions.mockReturnValue([])
        ConfigManager.getAutoConnect.mockReturnValue(false)
    })

    describe('getClasspathSeparator', () => {
        const originalPlatform = process.platform
        afterEach(() => {
            Object.defineProperty(process, 'platform', { value: originalPlatform })
        })

        it('should return ; for win32', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' })
            expect(LaunchArgumentBuilder.getClasspathSeparator()).toBe(';')
        })

        it('should return : for linux', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' })
            expect(LaunchArgumentBuilder.getClasspathSeparator()).toBe(':')
        })
    })

    describe('constructJVMArguments (1.12)', () => {
        it('should build 1.12 arguments correctly', async () => {
            // Mock classpathArg to avoid complex library resolution in this test
            builder.classpathArg = jest.fn().mockResolvedValue(['lib1.jar', 'lib2.jar'])

            const args = await builder.constructJVMArguments([], 'natives', false, false, null)

            expect(args).toContain('-Xmx2G')
            expect(args).toContain('-Xms1G')
            expect(args).toContain('-Djava.library.path=natives')
            expect(args).toContain('net.minecraft.launchwrapper.Launch')
        })
    })

    describe('constructJVMArguments (1.13+)', () => {
        beforeEach(() => {
            builder.server.rawServer.minecraftVersion = '1.18.2'
            builder.vanillaManifest.arguments = {
                jvm: ['-Xss1M'],
                game: ['--username', '${auth_player_name}', '--version', '${version_name}']
            }
            builder.modManifest.arguments = {
                jvm: ['-Dmodloader.version=1.0'],
                game: ['--tweakClass', 'some.Tweak']
            }
        })

        it('should replace placeholders in 1.13+ arguments', async () => {
            builder.classpathArg = jest.fn().mockResolvedValue(['lib.jar'])

            const args = await builder.constructJVMArguments([], 'natives', false, false, null)

            expect(args).toContain('TestPlayer')
            expect(args).toContain('testServer')
            expect(args).toContain('-Dmodloader.version=1.0')
            expect(args).toContain('--tweakClass')
        })

        it('should handle complex rules (os version)', async () => {
            builder.vanillaManifest.arguments.game.push({
                rules: [{
                    action: 'allow',
                    os: { name: 'windows' }
                }],
                value: '--win-only'
            })

            // Mock windows
            const originalPlatform = process.platform
            Object.defineProperty(process, 'platform', { value: 'win32' })

            const args = await builder.constructJVMArguments([], 'natives', false, false, null)
            expect(args).toContain('--win-only')

            Object.defineProperty(process, 'platform', { value: originalPlatform })
        })
    })

    describe('_resolveSanitizedJMArgs', () => {
        it('should remove forbidden flags and add G1GC if missing', () => {
            ConfigManager.getJVMOptions.mockReturnValue(['-XX:+UseConcMarkSweepGC'])
            const sanitized = builder._resolveSanitizedJMArgs([])
            expect(sanitized).not.toContain('-XX:+UseConcMarkSweepGC')
            expect(sanitized).toContain('-XX:+UseG1GC')
        })

        it('should not add G1GC if another GC is already present', () => {
            ConfigManager.getJVMOptions.mockReturnValue(['-XX:+UseZGC'])
            const sanitized = builder._resolveSanitizedJMArgs([])
            expect(sanitized).toContain('-XX:+UseZGC')
            expect(sanitized).not.toContain('-XX:+UseG1GC')
        })
    })

    describe('_processAutoConnectArg', () => {
        it('should add --server and --port for < 1.20', () => {
            builder.server.rawServer.autoconnect = true
            ConfigManager.getAutoConnect.mockReturnValue(true)
            builder.server.rawServer.minecraftVersion = '1.12.2'

            const args = []
            builder._processAutoConnectArg(args)
            expect(args).toContain('--server')
            expect(args).toContain('localhost')
            expect(args).toContain('--port')
            expect(args).toContain(25565)
        })

        it('should add --quickPlayMultiplayer for >= 1.20', () => {
            builder.server.rawServer.autoconnect = true
            ConfigManager.getAutoConnect.mockReturnValue(true)
            builder.server.rawServer.minecraftVersion = '1.20.1'

            const args = []
            builder._processAutoConnectArg(args)
            expect(args).toContain('--quickPlayMultiplayer')
            expect(args).toContain('localhost:25565')
        })
    })

    describe('classpathArg', () => {
        it('should include version jar and libraries', async () => {
            builder._resolveMojangLibraries = jest.fn().mockResolvedValue({ 'lib1': 'common/libraries/lib1.jar' })
            builder._resolveServerLibraries = jest.fn().mockReturnValue({ 'lib2': 'common/libraries/lib2.jar' })

            const cp = await builder.classpathArg([], 'natives', false, null, false)

            expect(cp).toContain(path.join(commonDir, 'versions', '1.12.2', '1.12.2.jar'))
            expect(cp).toContain('common/libraries/lib1.jar')
            expect(cp).toContain('common/libraries/lib2.jar')
        })
    })
})
