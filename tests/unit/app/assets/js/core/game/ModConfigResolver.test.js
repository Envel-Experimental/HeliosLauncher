jest.mock('fs', () => ({
    writeFileSync: jest.fn()
}))

const ModConfigResolver = require('../../../../../../../app/assets/js/core/game/ModConfigResolver')
const { Type } = require('../../../../../../../app/assets/js/core/common/DistributionClasses')
const fs = require('fs')
const path = require('path')

describe('ModConfigResolver', () => {
    describe('isModEnabled', () => {
        it('should return true if modCfg is null and no required def', () => {
            expect(ModConfigResolver.isModEnabled(null)).toBe(true)
        })

        it('should return def value if modCfg is null and required exists', () => {
            expect(ModConfigResolver.isModEnabled(null, { def: false })).toBe(false)
            expect(ModConfigResolver.isModEnabled(null, { def: true })).toBe(true)
        })

        it('should return boolean value if modCfg is boolean', () => {
            expect(ModConfigResolver.isModEnabled(true)).toBe(true)
            expect(ModConfigResolver.isModEnabled(false)).toBe(false)
        })

        it('should return value from object if modCfg is object', () => {
            expect(ModConfigResolver.isModEnabled({ value: true })).toBe(true)
            expect(ModConfigResolver.isModEnabled({ value: false })).toBe(false)
        })

        it('should return true if modCfg is object without value', () => {
            expect(ModConfigResolver.isModEnabled({})).toBe(true)
        })
    })

    describe('resolveModConfiguration', () => {
        let resolver
        const commonDir = '/common'
        
        beforeEach(() => {
            jest.clearAllMocks()
            resolver = new ModConfigResolver({}, {}, commonDir)
        })

        it('should resolve simple forge mods', () => {
            const mdls = [
                {
                    rawModule: { type: Type.ForgeMod },
                    getRequired: () => ({ value: true }),
                    getVersionlessMavenIdentifier: () => 'mod1',
                    subModules: []
                }
            ]
            const modCfg = { 'mod1': true }
            const result = resolver.resolveModConfiguration(modCfg, mdls)
            expect(result.fMods.length).toBe(1)
            expect(result.fMods[0].getVersionlessMavenIdentifier()).toBe('mod1')
        })

        it('should resolve submodules recursively', () => {
            const subMod = {
                rawModule: { type: Type.ForgeMod },
                getRequired: () => ({ value: true }),
                getVersionlessMavenIdentifier: () => 'sub1',
                subModules: []
            }
            const mdls = [
                {
                    rawModule: { type: Type.ForgeMod },
                    getRequired: () => ({ value: true }),
                    getVersionlessMavenIdentifier: () => 'mod1',
                    subModules: [subMod]
                }
            ]
            const modCfg = { 
                'mod1': { value: true, mods: { 'sub1': true } }
            }
            const result = resolver.resolveModConfiguration(modCfg, mdls)
            expect(result.fMods.length).toBe(2)
        })
    })

    describe('_lteMinorVersion', () => {
        it('should return true if version is less than or equal', () => {
            const resolver = new ModConfigResolver({}, { id: '1.12.2-forge' }, '')
            expect(resolver._lteMinorVersion(12)).toBe(true)
            expect(resolver._lteMinorVersion(13)).toBe(true)
            expect(resolver._lteMinorVersion(11)).toBe(false)
        })
    })

    describe('_requiresAbsolute', () => {
        it('should return false for old forge versions (<= 1.9)', () => {
            const resolver = new ModConfigResolver({}, { id: '1.8.9-forge' }, '')
            expect(resolver._requiresAbsolute()).toBe(false)
        })

        it('should return true for modern forge versions', () => {
            const resolver = new ModConfigResolver({}, { id: '1.12.2-14.23.5.2847' }, '')
            expect(resolver._requiresAbsolute()).toBe(true)
        })
    })

    describe('constructJSONModList', () => {
        it('should generate correct modList object', () => {
            const resolver = new ModConfigResolver({}, { id: '1.12.2-forge' }, '/common')
            const mods = [
                { getExtensionlessMavenIdentifier: () => 'mod1' }
            ]
            const result = resolver.constructJSONModList('forge', mods, './fml', './ll', false)
            expect(result.modRef).toContain('mod1')
            expect(result.repositoryRoot).toContain('modstore')
        })

        it('should save to disk if requested', () => {
            const resolver = new ModConfigResolver({}, { id: '1.12.2-forge' }, '/common')
            resolver.constructJSONModList('forge', [], './fml', './ll', true)
            expect(fs.writeFileSync).toHaveBeenCalled()
        })
    })

    describe('constructModList', () => {
        it('should return arguments for forge', () => {
            const resolver = new ModConfigResolver({}, {}, '/common')
            const mods = [
                { getExtensionlessMavenIdentifier: () => 'mod1' }
            ]
            const result = resolver.constructModList(mods, './list', false)
            expect(result).toContain('--fml.modLists')
            expect(fs.writeFileSync).toHaveBeenCalled()
        })
    })
})
