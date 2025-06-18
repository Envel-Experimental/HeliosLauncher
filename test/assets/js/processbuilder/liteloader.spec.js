const { expect } = require('chai'); // Or your preferred assertion library
const { setupLiteLoader } = require('../../../../app/assets/js/processbuilder/liteloader'); // Adjust path
const ConfigManager = require('../../../../app/assets/js/configmanager'); // Mock or use actual
const { Type } = require('helios-distribution-types');
const fs = require('fs-extra'); // For mocking fs.existsSync

// Mock isModEnabled if it's complex or to isolate tests
// const { isModEnabled } = require('../../../../app/assets/js/processbuilder/utils');
const mockUtils = {
    isModEnabled: (modCfg, required) => {
        // Simplified mock logic for testing liteloader
        if (modCfg === null || typeof modCfg === 'undefined') {
            return required ? required.def : true;
        }
        if (typeof modCfg === 'boolean') {
            return modCfg;
        }
        return typeof modCfg.value !== 'undefined' ? modCfg.value : true;
    }
};

describe('Process Builder LiteLoader Logic (liteloader.js)', () => {

    describe('setupLiteLoader(processBuilderInstance)', () => {
        let mockProcessBuilderInstance;
        let originalFsExistsSync;
        let originalConfigGetModConfiguration;

        beforeEach(() => {
            mockProcessBuilderInstance = {
                server: {
                    modules: [],
                    rawServer: { id: 'testServer' }
                },
                usingLiteLoader: false,
                llPath: null,
                // Mock any other properties accessed on the instance
            };
            originalFsExistsSync = fs.existsSync;
            originalConfigGetModConfiguration = ConfigManager.getModConfiguration;

            // Setup default mocks
            fs.existsSync = (p) => true; // Assume path exists by default
            ConfigManager.getModConfiguration = (id) => ({ mods: {} }); // Default empty mod config
        });

        afterEach(() => {
            fs.existsSync = originalFsExistsSync;
            ConfigManager.getModConfiguration = originalConfigGetModConfiguration;
        });

        it('should enable LiteLoader if a LiteLoader module is present, enabled, and its file exists', () => {
            // Arrange
            mockProcessBuilderInstance.server.modules = [
                {
                    rawModule: { type: Type.LiteLoader },
                    getRequired: () => ({ value: false, def: true }), // Optional, defaults to true
                    getVersionlessMavenIdentifier: () => 'com.example:liteloader',
                    getPath: () => '/path/to/liteloader.jar'
                }
            ];
            // ConfigManager.getModConfiguration should return config where this liteloader is enabled
            ConfigManager.getModConfiguration = (id) => ({
                mods: { 'com.example:liteloader': true }
            });

            // Act
            // Need to inject the mocked isModEnabled from mockUtils for this test
            const actualSetupLiteLoader = require('proxyquire')('../../../../app/assets/js/processbuilder/liteloader', {
                './utils': mockUtils,
                'fs-extra': fs // ensure fs-extra is also proxied if you mock it more deeply
            }).setupLiteLoader;
            actualSetupLiteLoader(mockProcessBuilderInstance);

            // Assert
            expect(mockProcessBuilderInstance.usingLiteLoader).to.be.true;
            expect(mockProcessBuilderInstance.llPath).to.equal('/path/to/liteloader.jar');
        });

        it('should not enable LiteLoader if module is not enabled in config', () => {
            mockProcessBuilderInstance.server.modules = [
                {
                    rawModule: { type: Type.LiteLoader },
                    getRequired: () => ({ value: false, def: true }),
                    getVersionlessMavenIdentifier: () => 'com.example:liteloader',
                    getPath: () => '/path/to/liteloader.jar'
                }
            ];
            ConfigManager.getModConfiguration = (id) => ({
                mods: { 'com.example:liteloader': false } // Mod is disabled
            });

            const actualSetupLiteLoader = require('proxyquire')('../../../../app/assets/js/processbuilder/liteloader', {
                './utils': mockUtils,
                'fs-extra': fs
            }).setupLiteLoader;
            actualSetupLiteLoader(mockProcessBuilderInstance);

            expect(mockProcessBuilderInstance.usingLiteLoader).to.be.false;
        });

        it('should not enable LiteLoader if file does not exist', () => {
            mockProcessBuilderInstance.server.modules = [
                {
                    rawModule: { type: Type.LiteLoader },
                    getRequired: () => ({ value: false, def: true }),
                    getVersionlessMavenIdentifier: () => 'com.example:liteloader',
                    getPath: () => '/path/to/liteloader.jar'
                }
            ];
            fs.existsSync = (p) => false; // LiteLoader jar does not exist

            const actualSetupLiteLoader = require('proxyquire')('../../../../app/assets/js/processbuilder/liteloader', {
                './utils': mockUtils,
                'fs-extra': fs
            }).setupLiteLoader;
            actualSetupLiteLoader(mockProcessBuilderInstance);

            expect(mockProcessBuilderInstance.usingLiteLoader).to.be.false;
        });

        it('should handle required LiteLoader modules correctly', () => {
            mockProcessBuilderInstance.server.modules = [
                {
                    rawModule: { type: Type.LiteLoader },
                    getRequired: () => ({ value: true }), // Required mod
                    getVersionlessMavenIdentifier: () => 'com.example:liteloader',
                    getPath: () => '/path/to/liteloader.jar'
                }
            ];
            // No need to check ConfigManager for required mods if they are marked as required:true

            const actualSetupLiteLoader = require('proxyquire')('../../../../app/assets/js/processbuilder/liteloader', {
                './utils': mockUtils, // isModEnabled won't be called for required:true
                'fs-extra': fs
            }).setupLiteLoader;
            actualSetupLiteLoader(mockProcessBuilderInstance);

            expect(mockProcessBuilderInstance.usingLiteLoader).to.be.true;
            expect(mockProcessBuilderInstance.llPath).to.equal('/path/to/liteloader.jar');
        });

    });
});
