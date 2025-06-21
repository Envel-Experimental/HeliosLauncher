// Using Jest's global expect
const ConfigManager = require('../../../../app/assets/js/configmanager')
// const path = require('path'); // Unused
const ProcessConfiguration = require('../../../../app/assets/js/processbuilder/modules/config')

// Import the module to be tested directly. Jest will use __mocks__ if they exist.
const { constructJVMArguments } = require('../../../../app/assets/js/processbuilder/jvmArgs')

// Import functions from mocked modules to assert calls against them
jest.mock('../../../../app/assets/js/processbuilder/utils') // Will use __mocks__/utils.js
jest.mock('../../../../app/assets/js/processbuilder/classpath') // Will use __mocks__/classpath.js
// eslint-disable-next-line no-unused-vars
const { getClasspathSeparator } = require('../../../../app/assets/js/processbuilder/utils') // Used by jvmArgs.js
const { classpathArg } = require('../../../../app/assets/js/processbuilder/classpath')

// Manually mock helios-core/common because it's not a local module with __mocks__
// eslint-disable-next-line no-unused-vars
const { mcVersionAtLeast, getMojangOS } = require('helios-core/common')
jest.mock('helios-core/common', () => ({
    mcVersionAtLeast: jest.fn(),
    getMojangOS: jest.fn()
}))


describe('Process Builder JVM Argument Logic (jvmArgs.js)', () => {
    let mockConfigInstance

    let dummyDistro
    let dummyVanillaManifest
    let dummyModManifest
    const dummyAuthUser = { displayName: 'TestUser', uuid: 'test-uuid-1234', accessToken: 'test-token', type: 'mojang' }
    const dummyLauncherVersion = '3.0.0'

    let originalCMFuncs = {}

    beforeEach(() => {
        const cmFunctionsToMock = [
            'getAutoConnect', 'getFullscreen', 'getGameWidth', 'getGameHeight',
            'getMaxRAM', 'getMinRAM', 'getJVMOptions', 'getInstanceDirectory',
            'getCommonDirectory', 'getLauncherDirectory'
        ]
        cmFunctionsToMock.forEach(funcName => {
            if (typeof ConfigManager[funcName] === 'function') {
                originalCMFuncs[funcName] = ConfigManager[funcName]
            }
        })

        ConfigManager.getInstanceDirectory = jest.fn().mockReturnValue('/test/instances')
        ConfigManager.getCommonDirectory = jest.fn().mockReturnValue('/test/common')
        ConfigManager.getLauncherDirectory = jest.fn().mockReturnValue('/launcher')
        ConfigManager.getAutoConnect = jest.fn().mockReturnValue(false)
        ConfigManager.getFullscreen = jest.fn().mockReturnValue(false)
        ConfigManager.getGameWidth = jest.fn().mockReturnValue(854)
        ConfigManager.getGameHeight = jest.fn().mockReturnValue(480)
        ConfigManager.getMaxRAM = jest.fn().mockReturnValue('1024M')
        ConfigManager.getMinRAM = jest.fn().mockReturnValue('512M')
        ConfigManager.getJVMOptions = jest.fn().mockReturnValue(['-XX:+UnlockExperimentalVMOptions'])

        dummyDistro = {
            rawServer: { id: 'testServer', minecraftVersion: '1.12.2', autoconnect: false },
            hostname: 'test.server.com',
            port: '25565',
            modules: []
        }
        dummyVanillaManifest = {
            id: '1.12.2',
            assets: '1.12',
            type: 'release',
            libraries: [],
            arguments: { jvm: [], game: [] },
            mainClass: 'net.minecraft.client.main.Main',
            minecraftArguments: ''
        }
        dummyModManifest = {
            mainClass: 'net.minecraft.launchwrapper.Launch',
            minecraftArguments: '--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userType ${user_type} --versionType ${version_type}',
            id: '1.12.2-forge-14.23.5.2855',
            arguments: { jvm: [], game: [] }
        }

        mockConfigInstance = new ProcessConfiguration(
            dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion
        )
        mockConfigInstance.setUsingLiteLoader(false)

        mcVersionAtLeast.mockReset()
        mcVersionAtLeast.mockImplementation((targetRange, versionToTest) => {
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
        getMojangOS.mockReset().mockReturnValue(process.platform === 'darwin' ? 'osx' : (process.platform === 'win32' ? 'windows' : 'linux'))

        getClasspathSeparator.mockClear()
        classpathArg.mockClear()
        classpathArg.mockReturnValue(['/mocked_cp.jar', '/another_mocked_cp.jar'])
    })

    afterEach(() => {
        for (const funcName in originalCMFuncs) {
            ConfigManager[funcName] = originalCMFuncs[funcName]
        }
        originalCMFuncs = {}
        jest.clearAllMocks()
    })


    describe('constructJVMArguments(config, mods, tempNativePath)', () => {
        it('should produce the correct argument list for MC version < 1.13', () => {
            dummyVanillaManifest.id = '1.12.2'
            dummyDistro.rawServer.minecraftVersion = '1.12.2'
            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion)

            const tempNativePath = '/tmp/natives_test_112'
            const mods = []
            const args = constructJVMArguments(mockConfigInstance, mods, tempNativePath)

            expect(classpathArg).toHaveBeenCalledWith(mockConfigInstance, mods, tempNativePath)
            expect(args).toContain('-cp')
            expect(args.join(' ')).toContain('/mocked_cp.jar:/another_mocked_cp.jar')
            expect(args).toContain('-Xmx1024M')
            expect(args).toContain('-Xms512M')
            expect(args).toContain('-XX:+UnlockExperimentalVMOptions')
            expect(args).toContain(`-Djava.library.path=${tempNativePath}`)
            expect(args).toContain(dummyModManifest.mainClass)
            expect(args.join(' ')).toContain(`--username ${dummyAuthUser.displayName}`)
            expect(args.join(' ')).toContain(`--version ${dummyDistro.rawServer.id}`)
        })

        it('should produce the correct argument list for MC version >= 1.13', () => {
            dummyVanillaManifest.id = '1.16.5'
            dummyDistro.rawServer.minecraftVersion = '1.16.5'
            dummyVanillaManifest.arguments = {
                jvm: ['-Dvanilla=jvmarg', '${classpath}', { rules: [{action: 'allow', os: {name: 'osx'}}], value: '-XstartOnFirstThread'}],
                game: ['--vanillaGameArg', '${auth_player_name}']
            }
            dummyModManifest.mainClass = 'cpw.mods.modlauncher.Launcher'
            dummyModManifest.arguments = { jvm: ['-Dforge.test=true'], game: ['--forgeGameArg'] }

            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion)

            const tempNativePath = '/tmp/natives_test_116'
            const mods = []
            const args = constructJVMArguments(mockConfigInstance, mods, tempNativePath)

            expect(classpathArg).toHaveBeenCalledWith(mockConfigInstance, mods, tempNativePath)
            expect(args).toContain(dummyModManifest.mainClass)
            expect(args).toContain('-Dforge.test=true')
            expect(args).toContain('-Dvanilla=jvmarg')
            expect(args.join(' ')).toContain(dummyAuthUser.displayName)
            expect(args).toContain('--forgeGameArg')
            if (process.platform === 'darwin') {
                // eslint-disable-next-line jest/no-conditional-expect
                expect(args).toContain('-XstartOnFirstThread')
            }
        })
    })
})
