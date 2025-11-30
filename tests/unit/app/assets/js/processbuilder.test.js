const path = require('path');
const ConfigManager = require('@app/assets/js/configmanager');

jest.mock('@app/assets/js/configmanager', () => ({
    getLauncherDirectory: jest.fn(),
    getCommonDirectory: jest.fn(),
    getInstanceDirectory: jest.fn(),
    getJavaExecutable: jest.fn(),
    getModConfiguration: jest.fn(),
    getLaunchDetached: jest.fn(),
    getMinRAM: jest.fn(),
    getMaxRAM: jest.fn(),
    getJVMOptions: jest.fn(),
    getFullscreen: jest.fn(),
    getGameWidth: jest.fn(),
    getGameHeight: jest.fn(),
    getAutoConnect: jest.fn(),
}));

jest.mock('@envel/helios-core', () => ({
    LoggerUtil: {
        getLogger: jest.fn(() => ({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        })),
    },
}));

jest.mock('@envel/helios-core/common', () => ({
    getMojangOS: jest.fn(),
    isLibraryCompatible: jest.fn(),
    mcVersionAtLeast: jest.fn(),
}));

jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

jest.mock('fs-extra', () => ({
    ensureDirSync: jest.fn(),
    existsSync: jest.fn(),
    writeFileSync: jest.fn(),
    remove: jest.fn(),
}));

const ProcessBuilder = require('@app/assets/js/processbuilder');

describe('ProcessBuilder', () => {
    let processBuilder;
    let distroServer;
    let vanillaManifest;
    let modManifest;
    let authUser;
    let launcherVersion;

    beforeEach(() => {
        distroServer = {
            rawServer: {
                id: 'test-server',
                minecraftVersion: '1.16.5',
            },
            modules: [],
        };
        vanillaManifest = {
            id: '1.16.5',
            arguments: {
                jvm: [],
                game: [],
            },
            libraries: [],
        };
        modManifest = {
            id: 'forge-1.16.5',
            minecraftArguments: '--username ${auth_player_name}', // Added missing minecraftArguments
            arguments: {
                jvm: [],
                game: [],
            },
            mainClass: 'net.minecraft.launchwrapper.Launch',
        };
        authUser = {
            uuid: 'test-uuid',
            displayName: 'TestUser',
            accessToken: 'test-token',
            type: 'mojang',
        };
        launcherVersion = '1.0.0';

        ConfigManager.getInstanceDirectory.mockReturnValue('/test/instance/dir');
        ConfigManager.getCommonDirectory.mockReturnValue('/test/common/dir');
        ConfigManager.getModConfiguration.mockReturnValue({ mods: {} });

        processBuilder = new ProcessBuilder(distroServer, vanillaManifest, modManifest, authUser, launcherVersion);
    });

    it('should construct JVM arguments correctly', () => {
        ConfigManager.getMaxRAM.mockReturnValue('4G');
        ConfigManager.getMinRAM.mockReturnValue('2G');
        ConfigManager.getJVMOptions.mockReturnValue([]);

        const args = processBuilder.constructJVMArguments([], 'temp/natives');
        expect(args).toContain('-Xmx4G');
        expect(args).toContain('-Xms2G');
    });
});
