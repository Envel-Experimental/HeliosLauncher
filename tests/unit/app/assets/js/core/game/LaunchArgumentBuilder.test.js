const path = require('path')

describe('LaunchArgumentBuilder', () => {
    let LaunchArgumentBuilder
    let ConfigManager
    let FileUtils
    
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

    let builder

    beforeEach(() => {
        jest.resetModules()
        
        // Correct path: tests/unit/app/assets/js/core/game/LaunchArgumentBuilder.test.js -> core/configmanager
        jest.mock('../../../../../../../app/assets/js/core/configmanager', () => ({
            getMaxRAM: jest.fn(),
            getMinRAM: jest.fn(),
            getJVMOptions: jest.fn(),
            getAutoConnect: jest.fn(),
            getGameWidth: jest.fn(),
            getGameHeight: jest.fn(),
            getFullscreen: jest.fn(),
            fetchWithTimeout: jest.fn()
        }))
        
        jest.mock('../../../../../../../app/assets/js/core/common/FileUtils', () => ({
            validateLocalFile: jest.fn()
        }))
        
        jest.mock('fs/promises', () => ({
            readFile: jest.fn(),
            writeFile: jest.fn(),
            mkdir: jest.fn().mockResolvedValue(),
            rm: jest.fn().mockResolvedValue()
        }))

        jest.mock('../../../../../../../app/assets/js/core/util/LoggerUtil', () => ({
            LoggerUtil: {
                getLogger: jest.fn(() => ({
                    debug: jest.fn(),
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn()
                }))
            }
        }))

        jest.mock('p-limit', () => ({
            __esModule: true,
            default: jest.fn(() => (fn) => fn())
        }))

        LaunchArgumentBuilder = require('../../../../../../../app/assets/js/core/game/LaunchArgumentBuilder')
        ConfigManager = require('../../../../../../../app/assets/js/core/configmanager')
        FileUtils = require('../../../../../../../app/assets/js/core/common/FileUtils')

        const serverClone = JSON.parse(JSON.stringify(mockServer))
        const manifestClone = JSON.parse(JSON.stringify(vanillaManifest))
        const modClone = JSON.parse(JSON.stringify(modManifest))

        builder = new LaunchArgumentBuilder(serverClone, manifestClone, modClone, authUser, launcherVersion, gameDir, commonDir)

        ConfigManager.getMaxRAM.mockReturnValue('2G')
        ConfigManager.getMinRAM.mockReturnValue('1G')
        ConfigManager.getJVMOptions.mockReturnValue([])
        ConfigManager.getAutoConnect.mockReturnValue(false)
        ConfigManager.getGameWidth.mockReturnValue(800)
        ConfigManager.getGameHeight.mockReturnValue(600)
        ConfigManager.getFullscreen.mockReturnValue(false)
    })

    describe('constructJVMArguments (1.12)', () => {
        it('should build 1.12 arguments correctly', async () => {
            builder.classpathArg = jest.fn().mockResolvedValue(['lib1.jar', 'lib2.jar'])
            const args = await builder.constructJVMArguments([], 'natives', false, false, null)
            expect(args).toContain('-Xmx2G')
            expect(args).toContain('-Xms1G')
            expect(args).toContain('net.minecraft.launchwrapper.Launch')
        })
    })

    describe('_resolveSanitizedJMArgs', () => {
        it('should remove forbidden flags and add G1GC if missing', () => {
            ConfigManager.getJVMOptions.mockReturnValue(['-XX:+UseConcMarkSweepGC'])
            const sanitized = builder._resolveSanitizedJMArgs([])
            expect(sanitized).not.toContain('-XX:+UseConcMarkSweepGC')
            expect(sanitized).toContain('-XX:+UseG1GC')
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
