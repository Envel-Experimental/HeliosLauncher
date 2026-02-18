const { getMojangOS, validateLibraryRules, validateLibraryNatives, isLibraryCompatible, mcVersionAtLeast } = require('@app/assets/js/core/common/MojangUtils')

describe('MojangUtils', () => {
    describe('getMojangOS', () => {
        const originalPlatform = process.platform

        afterEach(() => {
            Object.defineProperty(process, 'platform', { value: originalPlatform })
        })

        it('should return osx for darwin', () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' })
            expect(getMojangOS()).toBe('osx')
        })

        it('should return windows for win32', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' })
            expect(getMojangOS()).toBe('windows')
        })

        it('should return linux for linux', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' })
            expect(getMojangOS()).toBe('linux')
        })

        it('should return the platform if it is unknown', () => {
            Object.defineProperty(process, 'platform', { value: 'freebsd' })
            expect(getMojangOS()).toBe('freebsd')
        })
    })

    describe('validateLibraryRules', () => {
        const originalPlatform = process.platform

        afterEach(() => {
            Object.defineProperty(process, 'platform', { value: originalPlatform })
        })

        it('should return false if rules is null', () => {
            expect(validateLibraryRules(null)).toBe(false)
        })

        it('should allow if rule action is allow and os matches', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' })
            const rules = [{ action: 'allow', os: { name: 'windows' } }]
            expect(validateLibraryRules(rules)).toBe(true)
        })

        it('should disallow if rule action is allow and os does not match', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' })
            const rules = [{ action: 'allow', os: { name: 'windows' } }]
            expect(validateLibraryRules(rules)).toBe(false)
        })

        it('should allow if rule action is disallow and os does not match', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' })
            const rules = [{ action: 'disallow', os: { name: 'windows' } }]
            expect(validateLibraryRules(rules)).toBe(true)
        })

        it('should return true if no rules match', () => {
            const rules = [{ action: 'allow' }] // missing os
            expect(validateLibraryRules(rules)).toBe(true)
        })
    })

    describe('validateLibraryNatives', () => {
        const originalPlatform = process.platform

        afterEach(() => {
            Object.defineProperty(process, 'platform', { value: originalPlatform })
        })

        it('should return true if natives is null', () => {
            expect(validateLibraryNatives(null)).toBe(true)
        })

        it('should return true if current OS is in natives', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' })
            const natives = { windows: 'natives-windows' }
            expect(validateLibraryNatives(natives)).toBe(true)
        })

        it('should return false if current OS is not in natives', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' })
            const natives = { windows: 'natives-windows' }
            expect(validateLibraryNatives(natives)).toBe(false)
        })
    })

    describe('isLibraryCompatible', () => {
        it('should return true if both rules and natives are null', () => {
            expect(isLibraryCompatible(null, null)).toBe(true)
        })

        it('should prioritize rules if they are not null', () => {
            const rules = [{ action: 'allow', os: { name: 'windows' } }]
            Object.defineProperty(process, 'platform', { value: 'win32' })
            expect(isLibraryCompatible(rules, null)).toBe(true)
        })

        it('should use natives if rules is null', () => {
            const natives = { windows: 'natives-windows' }
            Object.defineProperty(process, 'platform', { value: 'win32' })
            expect(isLibraryCompatible(null, natives)).toBe(true)
        })
    })

    describe('mcVersionAtLeast', () => {
        it('should return true if version is equal', () => {
            expect(mcVersionAtLeast('1.12.2', '1.12.2')).toBe(true)
        })

        it('should return true if actual version is higher', () => {
            expect(mcVersionAtLeast('1.12.2', '1.13')).toBe(true)
        })

        it('should return false if actual version is lower', () => {
            expect(mcVersionAtLeast('1.13', '1.12.2')).toBe(false)
        })

        it('should handle different lengths of version strings (padded with zeros)', () => {
            expect(mcVersionAtLeast('1.12.0', '1.12')).toBe(true)
            expect(mcVersionAtLeast('1.12', '1.12.0')).toBe(true)
        })

        it('should correctly compare major versions', () => {
            expect(mcVersionAtLeast('2.0', '1.9.9')).toBe(false)
            expect(mcVersionAtLeast('1.9.9', '2.0')).toBe(true)
        })
    })
})
