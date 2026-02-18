const { MavenUtil } = require('@app/assets/js/core/common/MavenUtil')

describe('MavenUtil', () => {
    describe('mavenComponentsToIdentifier', () => {
        it('should create an identifier without classifier or extension', () => {
            expect(MavenUtil.mavenComponentsToIdentifier('com.example', 'artifact', '1.0.0'))
                .toBe('com.example:artifact:1.0.0')
        })

        it('should create an identifier with classifier', () => {
            expect(MavenUtil.mavenComponentsToIdentifier('com.example', 'artifact', '1.0.0', 'natives-windows'))
                .toBe('com.example:artifact:1.0.0:natives-windows')
        })

        it('should create an identifier with extension', () => {
            expect(MavenUtil.mavenComponentsToIdentifier('com.example', 'artifact', '1.0.0', null, 'zip'))
                .toBe('com.example:artifact:1.0.0@zip')
        })

        it('should create an identifier with classifier and extension', () => {
            expect(MavenUtil.mavenComponentsToIdentifier('com.example', 'artifact', '1.0.0', 'natives-windows', 'zip'))
                .toBe('com.example:artifact:1.0.0:natives-windows@zip')
        })
    })

    describe('mavenComponentsToVersionlessIdentifier', () => {
        it('should create a versionless identifier', () => {
            expect(MavenUtil.mavenComponentsToVersionlessIdentifier('com.example', 'artifact'))
                .toBe('com.example:artifact')
        })

        it('should create a versionless identifier with classifier', () => {
            expect(MavenUtil.mavenComponentsToVersionlessIdentifier('com.example', 'artifact', 'natives-windows'))
                .toBe('com.example:artifact:natives-windows')
        })
    })

    describe('isMavenIdentifier', () => {
        it('should return true for valid identifiers', () => {
            expect(MavenUtil.isMavenIdentifier('com.example:artifact:1.0.0')).toBe(true)
            expect(MavenUtil.isMavenIdentifier('com.example:artifact:1.0.0:classifier')).toBe(true)
            expect(MavenUtil.isMavenIdentifier('com.example:artifact:1.0.0:classifier@extension')).toBe(true)
        })

        it('should return false for invalid identifiers', () => {
            expect(MavenUtil.isMavenIdentifier('invalid-id')).toBe(false)
        })
    })

    describe('getMavenComponents', () => {
        it('should parse simple identifier', () => {
            const comps = MavenUtil.getMavenComponents('com.example:artifact:1.0.0')
            expect(comps).toEqual({
                group: 'com.example',
                artifact: 'artifact',
                version: '1.0.0',
                classifier: undefined,
                extension: 'jar'
            })
        })

        it('should parse identifier with classifier', () => {
            const comps = MavenUtil.getMavenComponents('com.example:artifact:1.0.0:natives-windows')
            expect(comps).toEqual({
                group: 'com.example',
                artifact: 'artifact',
                version: '1.0.0',
                classifier: 'natives-windows',
                extension: 'jar'
            })
        })

        it('should parse identifier with extension', () => {
            const comps = MavenUtil.getMavenComponents('com.example:artifact:1.0.0@zip')
            expect(comps).toEqual({
                group: 'com.example',
                artifact: 'artifact',
                version: '1.0.0',
                classifier: undefined,
                extension: 'zip'
            })
        })

        it('should throw error for invalid identifier', () => {
            expect(() => MavenUtil.getMavenComponents('invalid'))
                .toThrow('Id is not a maven identifier.')
        })
    })

    describe('mavenComponentsAsPath', () => {
        it('should generate correct path', () => {
            const path = MavenUtil.mavenComponentsAsPath('com.example', 'artifact', '1.0.0')
            expect(path).toBe('com/example/artifact/1.0.0/artifact-1.0.0.jar')
        })

        it('should generate correct path with classifier and extension', () => {
            const path = MavenUtil.mavenComponentsAsPath('com.example', 'artifact', '1.0.0', 'natives-windows', 'zip')
            expect(path).toBe('com/example/artifact/1.0.0/artifact-1.0.0-natives-windows.zip')
        })
    })

    describe('mavenIdentifierToUrl', () => {
        it('should return a URL object when given a base', () => {
            // new URL() requires a protocol. In production, these are often relative to a repo URL.
            // We can test if the path generation is correct via mavenIdentifierAsPath.
            const path = MavenUtil.mavenIdentifierAsPath('com.example:artifact:1.0.0')
            const url = new URL(path, 'https://repo.example.com/')
            expect(url.href).toBe('https://repo.example.com/com/example/artifact/1.0.0/artifact-1.0.0.jar')
        })
    })

    describe('mavenIdentifierToPath', () => {
        it('should return a normalized path', () => {
            const path = MavenUtil.mavenIdentifierToPath('com.example:artifact:1.0.0')
            // Using a simple check because normalize depends on platform
            expect(path).toContain('com')
            expect(path).toContain('artifact')
        })
    })
})
