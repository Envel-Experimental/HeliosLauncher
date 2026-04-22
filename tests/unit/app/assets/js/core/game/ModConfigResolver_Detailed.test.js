const path = require('path')

describe('ModConfigResolver Detailed Tests', () => {
    let ModConfigResolver
    let fs
    let Type

    beforeEach(() => {
        jest.resetModules()

        // Mock Dependencies
        jest.doMock('fs', () => ({
            writeFileSync: jest.fn()
        }))

        jest.doMock('@common/DistributionClasses', () => ({
            Type: {
                ForgeMod: 'ForgeMod',
                LiteMod: 'LiteMod',
                LiteLoader: 'LiteLoader',
                FabricMod: 'FabricMod',
                ForgeHosted: 'ForgeHosted',
                Fabric: 'Fabric',
                Library: 'Library'
            }
        }))

        ModConfigResolver = require('@core/game/ModConfigResolver')
        fs = require('fs')
        Type = require('@common/DistributionClasses').Type
    })

    describe('isModEnabled', () => {
        test('should return true if no config provided and no requirement def', () => {
            expect(ModConfigResolver.isModEnabled(null, null)).toBe(true)
        })

        test('should respect required.def if no config provided', () => {
            expect(ModConfigResolver.isModEnabled(null, { def: false })).toBe(false)
            expect(ModConfigResolver.isModEnabled(null, { def: true })).toBe(true)
        })

        test('should respect boolean config', () => {
            expect(ModConfigResolver.isModEnabled(true)).toBe(true)
            expect(ModConfigResolver.isModEnabled(false)).toBe(false)
        })

        test('should respect object config value', () => {
            expect(ModConfigResolver.isModEnabled({ value: true })).toBe(true)
            expect(ModConfigResolver.isModEnabled({ value: false })).toBe(false)
        })
    })

    describe('resolveModConfiguration', () => {
        test('should recursively resolve enabled mods with nested config', () => {
            const resolver = new ModConfigResolver({}, {}, '/common')
            const mockMdls = [
                {
                    rawModule: { type: Type.ForgeMod },
                    getRequired: () => ({ value: false, def: true }),
                    getVersionlessMavenIdentifier: () => 'mod1',
                    subModules: [
                        {
                            rawModule: { type: Type.ForgeMod },
                            getRequired: () => ({ value: false, def: false }),
                            getVersionlessMavenIdentifier: () => 'submod1',
                            subModules: []
                        }
                    ]
                }
            ]
            const mockCfg = {
                'mod1': { value: true, mods: { 'submod1': true } }
            }

            const res = resolver.resolveModConfiguration(mockCfg, mockMdls)
            expect(res.fMods.length).toBe(2)
            expect(res.fMods[0].getVersionlessMavenIdentifier()).toBe('submod1')
            expect(res.fMods[1].getVersionlessMavenIdentifier()).toBe('mod1')
        })
    })

    describe('Version Parsing', () => {
        test('_lteMinorVersion should parse minor version correctly', () => {
            const resolver = new ModConfigResolver({}, { id: '1.12.2-14.23.5.2854' }, '/common')
            expect(resolver._lteMinorVersion(12)).toBe(true)
            expect(resolver._lteMinorVersion(11)).toBe(false)
        })

        test('_requiresAbsolute should return correct boolean for Forge version', () => {
            // Forge 1.12.2-14.23.5.2854 -> > 14.23.3.2655 -> true
            const resolver = new ModConfigResolver({}, { id: '1.12.2-14.23.5.2854' }, '/common')
            expect(resolver._requiresAbsolute()).toBe(true)

            // Forge 1.12.2-14.23.2.2611 -> < 14.23.3.2655 -> false
            const resolverOld = new ModConfigResolver({}, { id: '1.12.2-14.23.2.2611' }, '/common')
            expect(resolverOld._requiresAbsolute()).toBe(false)
        })
    })

    describe('constructModList', () => {
        test('should return Fabric arguments when using Fabric', () => {
            const resolver = new ModConfigResolver({}, {}, '/common')
            const mockMods = [{ getPath: () => '/path/to/mod.jar' }]
            
            const args = resolver.constructModList(mockMods, '/mods.txt', true)
            expect(args).toEqual(['--fabric.addMods', '@/mods.txt'])
            expect(fs.writeFileSync).toHaveBeenCalledWith('/mods.txt', '/path/to/mod.jar', 'UTF-8')
        })

        test('should return Forge arguments when using Forge 1.13+', () => {
            const resolver = new ModConfigResolver({}, {}, '/common')
            const mockMods = [{ getExtensionlessMavenIdentifier: () => 'group:mod:1.0' }]
            
            const args = resolver.constructModList(mockMods, '/mods.txt', false)
            expect(args).toEqual(expect.arrayContaining(['--fml.modLists', '/mods.txt']))
            expect(fs.writeFileSync).toHaveBeenCalledWith('/mods.txt', 'group:mod:1.0', 'UTF-8')
        })
    })
})
