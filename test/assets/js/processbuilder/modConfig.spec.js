const { expect } = require('chai'); // Or your preferred assertion library
const { resolveModConfiguration, constructJSONModList, constructModList } = require('../../../../app/assets/js/processbuilder/modConfig'); // Adjust path
const { Type } = require('helios-distribution-types');
const ConfigManager = require('../../../../app/assets/js/configmanager'); // Mock or use actual
const fs = require('fs-extra'); // For mocking fs.writeFileSync
const path = require('path'); // For path.join if used in mocks

// Mock isModEnabled from utils.js
const mockUtils = {
    isModEnabled: (modCfg, required) => {
        if (modCfg === null || typeof modCfg === 'undefined') {
            return required ? required.def : true;
        }
        if (typeof modCfg === 'boolean') {
            return modCfg;
        }
        return typeof modCfg.value !== 'undefined' ? modCfg.value : true;
    }
};

describe('Process Builder Mod Configuration Logic (modConfig.js)', () => {
    let mockProcessBuilderInstance;
    let originalFsWriteFileSync;

    beforeEach(() => {
        mockProcessBuilderInstance = {
            commonDir: '/test/common',
            fmlDir: '/test/game/forgeModList.json',
            llDir: '/test/game/liteloaderModList.json',
            forgeModListFile: '/test/game/forgeMods.list',
            usingFabricLoader: false,
            modManifest: { id: '1.12.2-forge-14.23.5.2855' }, // Example
             // Mock any other properties accessed on the instance
            server: {
                rawServer: { id: 'testServer' }
            }
        };
        originalFsWriteFileSync = fs.writeFileSync;
        fs.writeFileSync = () => {}; // Mock writeFileSync to do nothing during tests
    });

    afterEach(() => {
        fs.writeFileSync = originalFsWriteFileSync;
    });

    describe('resolveModConfiguration(context, modCfg, mdls)', () => {
        it('should correctly resolve enabled ForgeMods and LiteMods', () => {
            const modules = [
                { rawModule: { type: Type.ForgeMod }, getVersionlessMavenIdentifier: () => 'fmod1', getRequired: () => ({value: false, def: true}), subModules: [] },
                { rawModule: { type: Type.LiteMod }, getVersionlessMavenIdentifier: () => 'lmod1', getRequired: () => ({value: false, def: true}), subModules: [] },
                { rawModule: { type: Type.ForgeMod }, getVersionlessMavenIdentifier: () => 'fmod_disabled', getRequired: () => ({value: false, def: true}), subModules: [] },
            ];
            const config = {
                'fmod1': true,
                'lmod1': { value: true },
                'fmod_disabled': false
            };

            // Use proxyquire to inject mocked isModEnabled
            const actualResolveModConfiguration = require('proxyquire')('../../../../app/assets/js/processbuilder/modConfig', {
                './utils': mockUtils
            }).resolveModConfiguration;

            const result = actualResolveModConfiguration(mockProcessBuilderInstance, config, modules);
            expect(result.fMods).to.have.lengthOf(1);
            expect(result.fMods[0].getVersionlessMavenIdentifier()).to.equal('fmod1');
            expect(result.lMods).to.have.lengthOf(1);
            expect(result.lMods[0].getVersionlessMavenIdentifier()).to.equal('lmod1');
        });

        it('should handle submodules correctly', () => {
             const modules = [
                {
                    rawModule: { type: Type.ForgeMod },
                    getVersionlessMavenIdentifier: () => 'parent_fmod',
                    getRequired: () => ({value: false, def: true}),
                    subModules: [
                        { rawModule: { type: Type.ForgeMod }, getVersionlessMavenIdentifier: () => 'child_fmod', getRequired: () => ({value: false, def: true}), subModules: [] }
                    ]
                }
            ];
            const config = {
                'parent_fmod': {
                    value: true,
                    mods: { 'child_fmod': true }
                }
            };
            const actualResolveModConfiguration = require('proxyquire')('../../../../app/assets/js/processbuilder/modConfig', {
                './utils': mockUtils
            }).resolveModConfiguration;
            const result = actualResolveModConfiguration(mockProcessBuilderInstance, config, modules);
            expect(result.fMods).to.have.lengthOf(2); // Parent and child
        });
    });

    describe('constructJSONModList(context, type, mods, save)', () => {
        it('should construct a Forge mod list for older versions', () => {
            mockProcessBuilderInstance.modManifest.id = '1.7.10-Forge10.13.4.1614-1.7.10'; // Example for _lteMinorVersion(context, 9) -> true
            const mods = [{ getExtensionlessMavenIdentifier: () => 'test:fmod:1.0' }];
            const result = constructJSONModList(mockProcessBuilderInstance, 'forge', mods, false);
            expect(result.repositoryRoot).to.equal(path.join(mockProcessBuilderInstance.commonDir, 'modstore'));
            expect(result.modRef).to.deep.equal(['test:fmod:1.0']);
        });

        it('should construct a Forge mod list for newer versions (absolute path)', () => {
            mockProcessBuilderInstance.modManifest.id = '1.16.5-forge-36.1.0'; // Newer
            const mods = [{ getExtensionlessMavenIdentifier: () => 'test:fmod:2.0' }];
            const result = constructJSONModList(mockProcessBuilderInstance, 'forge', mods, false);
            expect(result.repositoryRoot).to.equal('absolute:' + path.join(mockProcessBuilderInstance.commonDir, 'modstore'));
            expect(result.modRef).to.deep.equal(['test:fmod:2.0']);
        });

        it('should construct a LiteLoader mod list', () => {
            const mods = [{ getMavenIdentifier: () => 'com.example:litemod:1.0.0' }];
            const result = constructJSONModList(mockProcessBuilderInstance, 'liteloader', mods, false);
            expect(result.repositoryRoot).to.equal(path.join(mockProcessBuilderInstance.commonDir, 'modstore'));
            expect(result.modRef).to.deep.equal(['com.example:litemod:1.0.0']);
        });

        it('should save the file if save is true', (done) => {
            fs.writeFileSync = (filePath, content, encoding) => {
                expect(filePath).to.equal(mockProcessBuilderInstance.fmlDir);
                expect(encoding).to.equal('UTF-8');
                done(); // Async verification
            };
            const mods = [{ getExtensionlessMavenIdentifier: () => 'test:fmod:1.0' }];
            constructJSONModList(mockProcessBuilderInstance, 'forge', mods, true);
        });
    });

    describe('constructModList(context, mods)', () => {
        it('should construct a Fabric mod list when usingFabricLoader is true', () => {
            mockProcessBuilderInstance.usingFabricLoader = true;
            const mods = [{ getPath: () => '/mods/fabricmod.jar' }];
            const result = constructModList(mockProcessBuilderInstance, mods);
            expect(result).to.deep.equal(['--fabric.addMods', `@${mockProcessBuilderInstance.forgeModListFile}`]);
        });

        it('should construct a Forge 1.13+ mod list when usingFabricLoader is false', () => {
            mockProcessBuilderInstance.usingFabricLoader = false;
            const mods = [{ getExtensionlessMavenIdentifier: () => 'test:fmod:1.0' }];
            const result = constructModList(mockProcessBuilderInstance, mods);
            expect(result).to.deep.equal([
                '--fml.mavenRoots',
                path.join('..', '..', 'common', 'modstore'),
                '--fml.modLists',
                mockProcessBuilderInstance.forgeModListFile
            ]);
        });

        it('should return empty array if no mods', () => {
            const result = constructModList(mockProcessBuilderInstance, []);
            expect(result).to.deep.equal([]);
        });

        it('should write the mod list file', (done) => {
            fs.writeFileSync = (filePath, content, encoding) => {
                expect(filePath).to.equal(mockProcessBuilderInstance.forgeModListFile);
                expect(content).to.equal('test:fmod:1.0');
                expect(encoding).to.equal('UTF-8');
                done();
            };
            const mods = [{ getExtensionlessMavenIdentifier: () => 'test:fmod:1.0' }];
            constructModList(mockProcessBuilderInstance, mods);
        });
    });

});
