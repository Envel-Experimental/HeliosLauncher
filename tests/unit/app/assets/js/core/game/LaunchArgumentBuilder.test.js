const LaunchArgumentBuilder = require('@app/assets/js/core/game/LaunchArgumentBuilder');
const ConfigManager = require('@app/assets/js/configmanager');
const { getMojangOS, isLibraryCompatible, mcVersionAtLeast } = require('@app/assets/js/core/common/MojangUtils');
const { extractZip } = require('@app/assets/js/core/common/FileUtils');
const path = require('path');
const fs = require('fs/promises');

jest.mock('@app/assets/js/configmanager');
jest.mock('@app/assets/js/core/common/MojangUtils');
jest.mock('@app/assets/js/core/common/FileUtils');
jest.mock('fs/promises');
jest.mock('p-limit', () => () => (fn) => fn()); // Mock p-limit as simple executor

describe('LaunchArgumentBuilder', () => {
    let builder;
    const mockServer = {
        rawServer: { id: 'server1', minecraftVersion: '1.16.5' },
        modules: []
    };
    const mockVanillaManifest = {
        id: '1.16.5',
        arguments: { jvm: ['-DjvmArg=val'], game: ['--gameArg'] },
        libraries: [],
        mainClass: 'net.minecraft.client.main.Main',
        type: 'release',
        assets: 'legacy'
    };
    const mockModManifest = {
        id: 'forge-1.16.5',
        arguments: { jvm: ['-DmodArg=val'], game: [] },
        mainClass: 'net.minecraft.launchwrapper.Launch',
        minecraftArguments: '--username ${auth_player_name}'
    };
    const mockAuthUser = {
        displayName: 'PlayerOne',
        uuid: 'uuid-123',
        accessToken: 'token-abc',
        type: 'microsoft'
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // Setup default mocks
        ConfigManager.getMaxRAM.mockReturnValue('4G');
        ConfigManager.getMinRAM.mockReturnValue('2G');
        ConfigManager.getGameWidth.mockReturnValue(854);
        ConfigManager.getGameHeight.mockReturnValue(480);
        ConfigManager.getJVMOptions.mockReturnValue([]);
        ConfigManager.getFullscreen.mockReturnValue(false);
        ConfigManager.getAutoConnect.mockReturnValue(false);

        mcVersionAtLeast.mockImplementation((target, current) => {
            // Simple mock comparison: assume target 1.13 <= 1.16.5
            return target === '1.13';
        });

        getMojangOS.mockReturnValue('linux'); // Default OS for tests

        builder = new LaunchArgumentBuilder(
            mockServer,
            mockVanillaManifest,
            mockModManifest,
            mockAuthUser,
            '1.0.0',
            '/game/dir',
            '/common/dir'
        );
    });

    describe('constructJVMArguments', () => {
        it('should construct arguments for 1.13+', async () => {
            mcVersionAtLeast.mockReturnValue(true); // 1.13+

            const args = await builder.constructJVMArguments([], '/temp/natives', false, false, null);

            expect(args).toContain('-Xmx4G');
            expect(args).toContain('-Xms2G');
            expect(args).toContain('-DjvmArg=val');
            // Check placeholders replacement
            // Verify ModManifest JVM args are processed
            expect(args.some(a => a.includes('-DmodArg=val'))).toBe(true);
        });

        it('should construct arguments for 1.12 (Legacy)', async () => {
            mcVersionAtLeast.mockReturnValue(false); // < 1.13
            builder.server.rawServer.minecraftVersion = '1.12.2';

            const args = await builder.constructJVMArguments([], '/temp/natives', false, false, null);

            expect(args).toContain('-cp');
            expect(args).toContain('-Djava.library.path=/temp/natives');
            expect(args).toContain(mockModManifest.mainClass);
            // Forge legacy args
            expect(args).toContain('--username');
            expect(args).toContain('PlayerOne');
        });
    });

    describe('_resolveSanitizedJMArgs', () => {
        it('should remove forbidden flags and ensure G1GC', () => {
            const result = builder._resolveSanitizedJMArgs(['-XX:+UseConcMarkSweepGC']);
            expect(result).not.toContain('-XX:+UseConcMarkSweepGC');
            expect(result).toContain('-XX:+UseG1GC');
        });

        it('should not add G1GC if another GC is present', () => {
            ConfigManager.getJVMOptions.mockReturnValue(['-XX:+UseZGC']);
            const result = builder._resolveSanitizedJMArgs([]);
            expect(result).toContain('-XX:+UseZGC');
            expect(result).not.toContain('-XX:+UseG1GC'); // Already has ZGC
        });
    });

    describe('OS Specific Rules (1.13+)', () => {
        it('should filter arguments based on OS rules', async () => {
            mcVersionAtLeast.mockReturnValue(true);
            const complexManifest = { ...mockVanillaManifest };
            complexManifest.arguments.game = [
                {
                    rules: [{ action: 'allow', os: { name: 'osx' } }],
                    value: '-XstartOnFirstThread'
                },
                {
                    rules: [{ action: 'allow', os: { name: 'linux' } }],
                    value: '--linuxArg'
                }
            ];
            builder.vanillaManifest = complexManifest;
            getMojangOS.mockReturnValue('linux');

            const args = await builder.constructJVMArguments([], '/temp', false, false, null);

            expect(args).toContain('--linuxArg');
            expect(args).not.toContain('-XstartOnFirstThread');
        });
    });
});
