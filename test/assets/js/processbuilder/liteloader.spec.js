// eslint-disable-next-line no-unused-vars
// const { expect } = require('chai'); // Removed Chai expect, using Jest's global expect
// const { setupLiteLoader } = require('../../../../app/assets/js/processbuilder/liteloader'); // Loaded by proxyquire
const ConfigManager = require('../../../../app/assets/js/configmanager')
const { Type } = require('helios-distribution-types')
const fs = require('fs-extra') // For mocking fs.existsSync
const ProcessConfiguration = require('../../../../app/assets/js/processbuilder/modules/config')

const mockUtils = {
    isModEnabled: (modCfg, required) => {
        if (modCfg === null || typeof modCfg === 'undefined') {
            return required ? required.def : true
        }
        if (typeof modCfg === 'boolean') {
            return modCfg
        }
        return typeof modCfg.value !== 'undefined' ? modCfg.value : true
    }
}

describe('Process Builder LiteLoader Logic (liteloader.js)', () => {

    describe('setupLiteLoader(config)', () => {
        let mockConfigInstance
        let originalFsExistsSync
        let originalCMGetModConfiguration
        let originalCMGetInstanceDirectory
        let originalCMGetCommonDirectory

        const dummyDistro = {
            rawServer: { id: 'testServer', minecraftVersion: '1.12.2' },
            modules: []
        }
        const dummyVanillaManifest = { id: '1.12.2', libraries: [], arguments: {}, assets: '1.12.2', type: 'release' }
        const dummyModManifest = { id: '1.12.2-forge-x.y.z', arguments: {}, minecraftArguments: '' }
        const dummyAuthUser = { displayName: 'TestUser', uuid: 'test-uuid', accessToken: 'test-token', type: 'mojang' }
        const dummyLauncherVersion = '1.0.0'

        beforeEach(() => {
            originalFsExistsSync = fs.existsSync
            originalCMGetModConfiguration = ConfigManager.getModConfiguration
            originalCMGetInstanceDirectory = ConfigManager.getInstanceDirectory
            originalCMGetCommonDirectory = ConfigManager.getCommonDirectory

            fs.existsSync = jest.fn().mockReturnValue(true)
            ConfigManager.getModConfiguration = jest.fn().mockReturnValue({ mods: {} })
            ConfigManager.getInstanceDirectory = jest.fn().mockReturnValue('/test/instances')
            ConfigManager.getCommonDirectory = jest.fn().mockReturnValue('/test/common')

            dummyDistro.modules = []
            mockConfigInstance = new ProcessConfiguration(
                dummyDistro,
                dummyVanillaManifest,
                dummyModManifest,
                dummyAuthUser,
                dummyLauncherVersion
            )
        })

        afterEach(() => {
            fs.existsSync = originalFsExistsSync
            ConfigManager.getModConfiguration = originalCMGetModConfiguration
            ConfigManager.getInstanceDirectory = originalCMGetInstanceDirectory
            ConfigManager.getCommonDirectory = originalCMGetCommonDirectory
            jest.clearAllMocks()
        })

        it('should enable LiteLoader if a LiteLoader module is present, enabled, and its file exists', () => {
            dummyDistro.modules = [
                {
                    rawModule: { type: Type.LiteLoader },
                    getRequired: () => ({ value: false, def: true }),
                    getVersionlessMavenIdentifier: () => 'com.example:liteloader',
                    getPath: () => '/path/to/liteloader.jar'
                }
            ]
            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion)

            ConfigManager.getModConfiguration.mockReturnValue({
                mods: { 'com.example:liteloader': true }
            })
            fs.existsSync.mockReturnValue(true)

            // eslint-disable-next-line no-unused-vars
            const proxiedSetupLiteLoader = require('proxyquire')('../../../../app/assets/js/processbuilder/liteloader', {
                './utils.js': mockUtils,
                'fs-extra': fs
            }).setupLiteLoader
            proxiedSetupLiteLoader(mockConfigInstance)

            expect(mockConfigInstance.isUsingLiteLoader()).toBe(true) // Chai: .to.be.true;
            expect(mockConfigInstance.getLiteLoaderPath()).toBe('/path/to/liteloader.jar') // Chai: .to.equal(...)
        })

        it('should not enable LiteLoader if module is not enabled in config', () => {
            dummyDistro.modules = [
                {
                    rawModule: { type: Type.LiteLoader },
                    getRequired: () => ({ value: false, def: true }),
                    getVersionlessMavenIdentifier: () => 'com.example:liteloader',
                    getPath: () => '/path/to/liteloader.jar'
                }
            ]
            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion)
            ConfigManager.getModConfiguration.mockReturnValue({
                mods: { 'com.example:liteloader': false }
            })
            fs.existsSync.mockReturnValue(true)

            // eslint-disable-next-line no-unused-vars
            const proxiedSetupLiteLoader = require('proxyquire')('../../../../app/assets/js/processbuilder/liteloader', {
                './utils.js': mockUtils,
                'fs-extra': fs
            }).setupLiteLoader
            proxiedSetupLiteLoader(mockConfigInstance)

            expect(mockConfigInstance.isUsingLiteLoader()).toBe(false) // Chai: .to.be.false;
        })

        it('should not enable LiteLoader if file does not exist', () => {
            dummyDistro.modules = [
                {
                    rawModule: { type: Type.LiteLoader },
                    getRequired: () => ({ value: false, def: true }),
                    getVersionlessMavenIdentifier: () => 'com.example:liteloader',
                    getPath: () => '/path/to/liteloader.jar'
                }
            ]
            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion)
            ConfigManager.getModConfiguration.mockReturnValue({
                mods: { 'com.example:liteloader': true }
            })
            fs.existsSync.mockReturnValue(false)

            // eslint-disable-next-line no-unused-vars
            const proxiedSetupLiteLoader = require('proxyquire')('../../../../app/assets/js/processbuilder/liteloader', {
                './utils.js': mockUtils,
                'fs-extra': fs
            }).setupLiteLoader
            proxiedSetupLiteLoader(mockConfigInstance)

            expect(mockConfigInstance.isUsingLiteLoader()).toBe(false) // Chai: .to.be.false;
        })

        it('should handle required LiteLoader modules correctly (file exists)', () => {
            dummyDistro.modules = [
                {
                    rawModule: { type: Type.LiteLoader },
                    getRequired: () => ({ value: true }),
                    getVersionlessMavenIdentifier: () => 'com.example:liteloader',
                    getPath: () => '/path/to/liteloader.jar'
                }
            ]
            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion)
            fs.existsSync.mockReturnValue(true)

            // eslint-disable-next-line no-unused-vars
            const proxiedSetupLiteLoader = require('proxyquire')('../../../../app/assets/js/processbuilder/liteloader', {
                './utils.js': mockUtils,
                'fs-extra': fs
            }).setupLiteLoader
            proxiedSetupLiteLoader(mockConfigInstance)

            expect(mockConfigInstance.isUsingLiteLoader()).toBe(true) // Chai: .to.be.true;
            expect(mockConfigInstance.getLiteLoaderPath()).toBe('/path/to/liteloader.jar') // Chai: .to.equal(...)
        })

        it('should NOT enable required LiteLoader module if file does NOT exist', () => {
            dummyDistro.modules = [
                {
                    rawModule: { type: Type.LiteLoader },
                    getRequired: () => ({ value: true }),
                    getVersionlessMavenIdentifier: () => 'com.example:liteloader',
                    getPath: () => '/path/to/liteloader.jar'
                }
            ]
            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifest, dummyModManifest, dummyAuthUser, dummyLauncherVersion)
            fs.existsSync.mockReturnValue(false) // File does not exist

            // eslint-disable-next-line no-unused-vars
            const proxiedSetupLiteLoader = require('proxyquire')('../../../../app/assets/js/processbuilder/liteloader', {
                './utils.js': mockUtils,
                'fs-extra': fs
            }).setupLiteLoader
            proxiedSetupLiteLoader(mockConfigInstance)

            expect(mockConfigInstance.isUsingLiteLoader()).toBe(false) // Chai: .to.be.false;
        })
    })
})
