const { DistributionIndexProcessor } = require('@app/assets/js/core/dl/DistributionIndexProcessor')
const crypto = require('crypto')

// Mock FileUtils dependencies
jest.mock('@app/assets/js/core/common/FileUtils', () => ({
    validateLocalFile: jest.fn().mockResolvedValue(false),
    getVersionJsonPath: jest.fn().mockReturnValue('/mock/version.json'),
    safeEnsureDir: jest.fn().mockResolvedValue(),
    readFileFromZip: jest.fn().mockResolvedValue(Buffer.from('{}'))
}))

jest.mock('@app/assets/js/core/common/MojangUtils', () => ({
    mcVersionAtLeast: jest.fn().mockReturnValue(false)
}))

// We need a helper to generate mock module classes with rawModule property
class MockModule {
    constructor(rawModule) {
        this.rawModule = rawModule
        this.subModules = []
    }
    hasSubModules() {
        return this.subModules && this.subModules.length > 0
    }
    getPath() {
        return this.rawModule ? this.rawModule.path || '/mock/path' : '/mock/path'
    }
    getMavenComponents() {
        return {
            version: this.rawModule ? this.rawModule.version || '1.0.0' : '1.0.0'
        }
    }
}

describe('DistributionIndexProcessor Fuzzing', () => {
    test('Fuzz: modules tree and Forge parsing resilience', async () => {
        const fuzzCycles = 500

        for (let i = 0; i < fuzzCycles; i++) {
            // Fuzz structure for module raw properties
            const fuzzedModuleData = () => {
                const rand = Math.random()
                if (rand < 0.1) return null
                if (rand < 0.2) return {}
                
                return {
                    id: Math.random() > 0.5 ? crypto.randomBytes(8).toString('hex') : null,
                    force: Math.random() > 0.5,
                    type: Math.random() > 0.5 ? 'forge' : 'fabric',
                    path: Math.random() > 0.5 ? `folder/${crypto.randomBytes(5).toString('hex')}` : null,
                    version: Math.random() > 0.5 ? `${crypto.randomInt(1, 20)}.${crypto.randomInt(0, 100)}` : null,
                    artifact: Math.random() > 0.3 ? {
                        SHA256: Math.random() > 0.3 ? crypto.randomBytes(32).toString('hex') : null,
                        size: Math.random() > 0.3 ? crypto.randomInt(1, 10000000) : null,
                        url: Math.random() > 0.3 ? 'https://my-server.com/mod.jar' : null
                    } : null
                }
            }

            // Generate fuzzed modules and submodules
            const buildTree = (depth = 0) => {
                const count = crypto.randomInt(0, 5)
                const list = []
                for (let j = 0; j < count; j++) {
                    const raw = fuzzedModuleData()
                    const mod = new MockModule(raw)
                    if (depth < 2 && Math.random() > 0.4) {
                        mod.subModules = buildTree(depth + 1)
                    }
                    list.push(mod)
                }
                return list
            }

            const modules = buildTree()

            // Build fuzzed server and distribution
            const distribution = {
                getServerById: () => ({
                    modules: modules,
                    rawServer: {
                        minecraftVersion: Math.random() > 0.5 ? '1.12.2' : null
                    }
                })
            }

            const processor = new DistributionIndexProcessor('/mock/common', distribution, 'server-id')

            // 1. Run validateModules
            try {
                await processor.validateModules(modules)
            } catch (e) {
                if (e.name === 'TypeError') {
                    console.error('validateModules caught TypeError:', e.stack)
                }
                // Ensure it is not a TypeError or crash
                expect(e.name).not.toBe('TypeError')
                expect(e.name).not.toBe('ReferenceError')
            }

            // 2. Fuzz Forge Gradle Version Checking
            const forgeVersions = [
                '1.12.2-14.23.5.2847',
                '14.23.5.2847',
                'invalid-version-string',
                '',
                null,
                undefined,
                '1.12.2-14.23.5.2848-extra',
                '1.12-14.23.5',
                '1.12-14.23.5.2847.99',
                '1.12.2-14.23.5.2846'
            ]
            const randForge = forgeVersions[crypto.randomInt(0, forgeVersions.length)]
            const randMc = Math.random() > 0.5 ? '1.12.2' : '1.16.5'

            try {
                DistributionIndexProcessor.isForgeGradle3(randMc, randForge)
            } catch (e) {
                // ForgeGradle checks can throw custom "Forge version is complex" error, that's expected
                expect(e.message).not.toContain('Cannot read properties')
                expect(e.name).not.toBe('TypeError')
            }
        }
    })
})
