// Functions under test will be loaded via proxyquire where ./utils is stubbed
const { Type } = require('helios-distribution-types')
const ConfigManager = require('../../../../app/assets/js/configmanager')
const fs = require('fs-extra')
const path = require('path')
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

describe('Process Builder Mod Configuration Logic (modConfig.js)', () => {
    let mockConfigInstance
    let originalFsWriteFileSync
    let originalCMGetInstanceDirectory
    let originalCMGetCommonDirectory
    let proxiedModConfig

    let dummyDistro
    const dummyVanillaManifestBase = { id: '1.12.2', libraries: [], arguments: {}, assets: '1.12.2', type: 'release' }
    const dummyModManifestBase = { id: '1.12.2-forge-14.23.5.2855', arguments: {}, minecraftArguments: '' }
    const dummyAuthUser = { displayName: 'TestUser', uuid: 'test-uuid', accessToken: 'test-token', type: 'mojang' }
    const dummyLauncherVersion = '1.0.0'

    beforeEach(() => {
        originalFsWriteFileSync = fs.writeFileSync
        originalCMGetInstanceDirectory = ConfigManager.getInstanceDirectory
        originalCMGetCommonDirectory = ConfigManager.getCommonDirectory

        fs.writeFileSync = jest.fn()
        ConfigManager.getInstanceDirectory = jest.fn().mockReturnValue('/test/instances')
        ConfigManager.getCommonDirectory = jest.fn().mockReturnValue('/test/common')

        dummyDistro = {
            rawServer: { id: 'testServer', minecraftVersion: '1.12.2' },
            modules: []
        }

        mockConfigInstance = new ProcessConfiguration(
            dummyDistro,
            {...dummyVanillaManifestBase, id: dummyModManifestBase.id.split('-')[0] },
            {...dummyModManifestBase},
            dummyAuthUser,
            dummyLauncherVersion
        )
        mockConfigInstance.setUsingFabricLoader(false)

        proxiedModConfig = require('proxyquire')('../../../../app/assets/js/processbuilder/modConfig', {
            './utils.js': mockUtils,
            'fs-extra': fs,
        })
    })

    afterEach(() => {
        fs.writeFileSync = originalFsWriteFileSync
        ConfigManager.getInstanceDirectory = originalCMGetInstanceDirectory
        ConfigManager.getCommonDirectory = originalCMGetCommonDirectory
        jest.clearAllMocks()
    })

    describe('resolveModConfiguration(config, modCfg, mdls)', () => {
        it('should correctly resolve enabled ForgeMods and LiteMods', () => {
            const serverModules = [
                { rawModule: { type: Type.ForgeMod }, getVersionlessMavenIdentifier: () => 'fmod1', getRequired: () => ({value: false, def: true}), subModules: [] },
                { rawModule: { type: Type.LiteMod }, getVersionlessMavenIdentifier: () => 'lmod1', getRequired: () => ({value: false, def: true}), subModules: [] },
                { rawModule: { type: Type.ForgeMod }, getVersionlessMavenIdentifier: () => 'fmod_disabled', getRequired: () => ({value: false, def: true}), subModules: [] },
            ]
            const modConfiguration = {
                'fmod1': true,
                'lmod1': { value: true },
                'fmod_disabled': false
            }

            dummyDistro.modules = serverModules
            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifestBase, dummyModManifestBase, dummyAuthUser, dummyLauncherVersion)

            const result = proxiedModConfig.resolveModConfiguration(mockConfigInstance, modConfiguration, serverModules)
            expect(result.fMods).toHaveLength(1)
            expect(result.fMods[0].getVersionlessMavenIdentifier()).toBe('fmod1')
            expect(result.lMods).toHaveLength(1)
            expect(result.lMods[0].getVersionlessMavenIdentifier()).toBe('lmod1')
        })

        it('should handle submodules correctly', () => {
            const serverModules = [
                {
                    rawModule: { type: Type.ForgeMod },
                    getVersionlessMavenIdentifier: () => 'parent_fmod',
                    getRequired: () => ({value: false, def: true}),
                    subModules: [
                        { rawModule: { type: Type.ForgeMod }, getVersionlessMavenIdentifier: () => 'child_fmod', getRequired: () => ({value: false, def: true}), subModules: [] }
                    ]
                }
            ]
            const modConfiguration = {
                'parent_fmod': {
                    value: true,
                    mods: { 'child_fmod': true }
                }
            }
            dummyDistro.modules = serverModules
            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifestBase, dummyModManifestBase, dummyAuthUser, dummyLauncherVersion)

            const result = proxiedModConfig.resolveModConfiguration(mockConfigInstance, modConfiguration, serverModules)
            expect(result.fMods).toHaveLength(2)
        })
    })

    describe('constructJSONModList(config, type, mods, save)', () => {
        it('should construct a Forge mod list for older versions (e.g. MC 1.7.10, specific Forge)', () => {
            const specificModManifest = {...dummyModManifestBase, id: '1.7.10-Forge10.13.4.1614-1.7.10'}
            mockConfigInstance = new ProcessConfiguration(dummyDistro, dummyVanillaManifestBase, specificModManifest, dummyAuthUser, dummyLauncherVersion)

            const mods = [{ getExtensionlessMavenIdentifier: () => 'test:fmod:1.0' }]
            const result = proxiedModConfig.constructJSONModList(mockConfigInstance, 'forge', mods, false)
            expect(result.repositoryRoot).toBe(path.join(mockConfigInstance.getCommonDirectory(), 'modstore'))
            expect(result.modRef).toEqual(['test:fmod:1.0'])
        })

        it('should construct a Forge mod list for newer versions (e.g. MC 1.16.5, absolute path)', () => {
            const specificModManifest = {...dummyModManifestBase, id: '1.16.5-forge-36.1.0'}
            mockConfigInstance = new ProcessConfiguration(dummyDistro, {...dummyVanillaManifestBase, id: '1.16.5'}, specificModManifest, dummyAuthUser, dummyLauncherVersion)

            const mods = [{ getExtensionlessMavenIdentifier: () => 'test:fmod:2.0' }]
            const result = proxiedModConfig.constructJSONModList(mockConfigInstance, 'forge', mods, false)
            expect(result.repositoryRoot).toBe('absolute:' + path.join(mockConfigInstance.getCommonDirectory(), 'modstore'))
            expect(result.modRef).toEqual(['test:fmod:2.0'])
        })

        it('should construct a LiteLoader mod list', () => {
            const mods = [{ getMavenIdentifier: () => 'com.example:litemod:1.0.0' }]
            const result = proxiedModConfig.constructJSONModList(mockConfigInstance, 'liteloader', mods, false)
            expect(result.repositoryRoot).toBe(path.join(mockConfigInstance.getCommonDirectory(), 'modstore'))
            expect(result.modRef).toEqual(['com.example:litemod:1.0.0'])
        })

        it('should save the file if save is true', () => {
            const mods = [{ getExtensionlessMavenIdentifier: () => 'test:fmod:1.0' }]
            proxiedModConfig.constructJSONModList(mockConfigInstance, 'forge', mods, true)
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                mockConfigInstance.getFmlDirectory(),
                expect.any(String),
                'UTF-8'
            )
        })
    })

    describe('constructModList(config, mods)', () => {
        it('should construct a Fabric mod list when usingFabricLoader is true', () => {
            mockConfigInstance.setUsingFabricLoader(true)
            const mods = [{ getPath: () => '/mods/fabricmod.jar' }]
            const result = proxiedModConfig.constructModList(mockConfigInstance, mods)
            expect(result).toEqual(['--fabric.addMods', `@${mockConfigInstance.getForgeModListFile()}`])
            expect(fs.writeFileSync).toHaveBeenCalled()
        })

        it('should construct a Forge 1.13+ mod list when usingFabricLoader is false', () => {
            mockConfigInstance.setUsingFabricLoader(false)
            const gameDir = mockConfigInstance.getGameDirectory()
            const commonDir = mockConfigInstance.getCommonDirectory()
            const expectedRelativePath = path.relative(gameDir, path.join(commonDir, 'modstore')).replace(/\\/g, '/')

            const mods = [{ getExtensionlessMavenIdentifier: () => 'test:fmod:1.0' }]
            const result = proxiedModConfig.constructModList(mockConfigInstance, mods)
            expect(result).toEqual([
                '--fml.mavenRoots',
                expectedRelativePath,
                '--fml.modLists',
                path.basename(mockConfigInstance.getForgeModListFile())
            ])
            expect(fs.writeFileSync).toHaveBeenCalled()
        })

        it('should return empty array if no mods', () => {
            const result = proxiedModConfig.constructModList(mockConfigInstance, [])
            expect(result).toEqual([])
            expect(fs.writeFileSync).not.toHaveBeenCalled()
        })

        it('should write the mod list file if mods are present', () => {
            const mods = [{ getExtensionlessMavenIdentifier: () => 'test:fmod:1.0' }]
            proxiedModConfig.constructModList(mockConfigInstance, mods)
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                mockConfigInstance.getForgeModListFile(),
                'test:fmod:1.0',
                'UTF-8'
            )
        })
    })
})
