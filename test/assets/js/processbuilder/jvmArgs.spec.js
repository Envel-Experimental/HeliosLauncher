const { expect } = require('chai');
const { constructJVMArguments } = require('../../../../app/assets/js/processbuilder/jvmArgs');
const ConfigManager = require('../../../../app/assets/js/configmanager');
const { mcVersionAtLeast } = require('helios-core/common'); // Real one, or mock if complex interactions
const path = require('path');

// Mocks for dependencies of jvmArgs.js and its helpers
const mockUtils = {
    getClasspathSeparator: () => (process.platform === 'win32' ? ';' : ':')
};

const mockClasspath = {
    classpathArg: (context, mods, tempNativePath) => ['/cp/dummy.jar', '/cp/another.jar']
};

describe('Process Builder JVM Argument Logic (jvmArgs.js)', () => {
    let mockProcessBuilderInstance;

    beforeEach(() => {
        // Reset ConfigManager mocks if they were changed by other tests
        ConfigManager.getAutoConnect = () => false;
        ConfigManager.getFullscreen = () => false;
        ConfigManager.getGameWidth = () => 854;
        ConfigManager.getGameHeight = () => 480;
        ConfigManager.getMaxRAM = () => '1024M';
        ConfigManager.getMinRAM = () => '512M';
        ConfigManager.getJVMOptions = () => ['-XX:+UnlockExperimentalVMOptions'];


        mockProcessBuilderInstance = {
            server: {
                rawServer: {
                    id: 'testServer',
                    minecraftVersion: '1.12.2', // Default to 1.12.2 for _constructJVMArguments112 path
                    autoconnect: false
                },
                hostname: 'test.server.com',
                port: '25565'
            },
            modManifest: {
                mainClass: 'net.minecraft.launchwrapper.Launch',
                minecraftArguments: '--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userType ${user_type} --versionType ${version_type}',
                id: '1.12.2-forge-14.23.5.2855' // for _lteMinorVersion
            },
            vanillaManifest: { // For 1.13+ path primarily
                id: '1.16.5',
                assets: '1.16',
                type: 'release',
                arguments: {
                    jvm: [
                        '-Djava.rmi.server.useCodebaseOnly=true',
                        '-Djava.rmi.server.useCodebaseOnly=true',
                        {
                            rules: [{ action: 'allow', os: { name: 'osx' } }],
                            value: '-XstartOnFirstThread'
                        }
                    ],
                    game: [
                        '--launchTarget',
                        '${version_name}'
                    ]
                }
            },
            authUser: {
                displayName: 'TestUser',
                uuid: 'test-uuid-1234',
                accessToken: 'test-token',
                type: 'mojang' // or 'microsoft'
            },
            launcherVersion: '3.0.0',
            gameDir: '/test/gameDir',
            commonDir: '/test/commonDir',
            libPath: '/test/commonDir/libraries',
            fmlDir: '/test/gameDir/forgeModList.json',
            llDir: '/test/gameDir/liteloaderModList.json',
            usingLiteLoader: false,
            // classpathArg is now imported into jvmArgs, so we don't mock it on the instance.
            // The actual classpathArg will be mocked via proxyquire.
        };
    });

    const getPatchedConstructJVMArgs = () => {
        return require('proxyquire')('../../../../app/assets/js/processbuilder/jvmArgs', {
            './utils': mockUtils,
            './classpath': mockClasspath,
            // Mock helios-core/common if specific behaviors are needed for mcVersionAtLeast or getMojangOS
            // 'helios-core/common': {
            //     mcVersionAtLeast: (current, target) => { /* mock logic */ return current === target || parseFloat(current) > parseFloat(target); },
            //     getMojangOS: () => process.platform === 'darwin' ? 'osx' : (process.platform === 'win32' ? 'windows' : 'linux')
            // }
        }).constructJVMArguments;
    };

    describe('constructJVMArguments(context, mods, tempNativePath)', () => {
        it('should call _constructJVMArguments112 for MC version < 1.13', () => {
            mockProcessBuilderInstance.server.rawServer.minecraftVersion = '1.12.2';
            const tempNativePath = '/tmp/natives';
            const mods = [];
            const patchedConstructJVMArguments = getPatchedConstructJVMArgs();
            const args = patchedConstructJVMArguments(mockProcessBuilderInstance, mods, tempNativePath);

            // Check for a distinctive arg from _constructJVMArguments112
            expect(args).to.include(mockProcessBuilderInstance.modManifest.mainClass); // mainClass is a good indicator
            expect(args.join(' ')).to.include(mockProcessBuilderInstance.authUser.displayName); // From _resolveForgeArgs
        });

        it('should call _constructJVMArguments113 for MC version >= 1.13', () => {
            mockProcessBuilderInstance.server.rawServer.minecraftVersion = '1.16.5';
             // Provide modManifest for 1.13+ too, as _constructJVMArguments113 might use its jvm args
            mockProcessBuilderInstance.modManifest.arguments = { jvm: ['-Dforge.test=true'] };
            mockProcessBuilderInstance.modManifest.mainClass = 'cpw.mods.modlauncher.Launcher';


            const tempNativePath = '/tmp/natives';
            const mods = [];
            const patchedConstructJVMArguments = getPatchedConstructJVMArgs();
            const args = patchedConstructJVMArguments(mockProcessBuilderInstance, mods, tempNativePath);

            // Check for a distinctive arg from _constructJVMArguments113
            expect(args).to.include(mockProcessBuilderInstance.modManifest.mainClass);
            expect(args).to.include('-Dforge.test=true');
            expect(args.join(' ')).to.include(mockProcessBuilderInstance.authUser.displayName); // From vanilla args replacement
        });
    });

    // More detailed tests could be written for _constructJVMArguments112, _constructJVMArguments113,
    // _resolveForgeArgs, and _processAutoConnectArg if they were exported or if testing them
    // through the main constructJVMArguments becomes too complex.
    // For now, this provides a basic structural test.

});
