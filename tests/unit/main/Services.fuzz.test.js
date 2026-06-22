const CryptoService = require('../../../app/main/CryptoService')
const ModService = require('../../../app/main/ModService')
const FsService = require('../../../app/main/FsService')
const crypto = require('crypto')
const path = require('path')

// Capture handlers registered on ipcMain
const handlers = {}
const syncHandlers = {}

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn((channel, cb) => {
            handlers[channel] = cb
        }),
        on: jest.fn((channel, cb) => {
            syncHandlers[channel] = cb
        })
    },
    app: {
        getAppPath: jest.fn().mockReturnValue('/mock/app/path')
    }
}))

jest.mock('../../../app/assets/js/core/configmanager', () => ({
    getLauncherDirectorySync: jest.fn().mockReturnValue('/mock/launcher'),
    getDataDirectory: jest.fn().mockReturnValue('/mock/data'),
    getCommonDirectorySync: jest.fn().mockReturnValue('/mock/common'),
    getLauncherDirectory: jest.fn().mockReturnValue('/mock/launcher'),
    getCommonDirectory: jest.fn().mockReturnValue('/mock/common'),
    save: jest.fn()
}))

// Mock fs to prevent real file/directory creation during tests
jest.mock('fs/promises', () => ({
    readFile: jest.fn().mockResolvedValue(''),
    writeFile: jest.fn().mockResolvedValue(),
    mkdir: jest.fn().mockResolvedValue(),
    access: jest.fn().mockResolvedValue(),
    readdir: jest.fn().mockResolvedValue([]),
    rm: jest.fn().mockResolvedValue(),
    rmdir: jest.fn().mockResolvedValue(),
    unlink: jest.fn().mockResolvedValue(),
    rename: jest.fn().mockResolvedValue()
}))

describe('Main Process Services Fuzzing', () => {

    beforeAll(() => {
        // Initialize services to register their handlers
        CryptoService.init()
        FsService.init()
        ModService.init()
    })
    
    describe('CryptoService Fuzzing', () => {
        test('Fuzz: crypto:hashSync and crypto:hash algorithm validation', async () => {
            // Generate 1000 random/malformed algorithm names
            for (let i = 0; i < 1000; i++) {
                const randomAlgo = crypto.randomBytes(crypto.randomInt(1, 100)).toString('hex')
                
                // Should not crash, but return null/warn for disallowed algorithm
                expect(() => {
                    const mockEvent = { returnValue: null }
                    if (syncHandlers['crypto:hashSync']) {
                        syncHandlers['crypto:hashSync'](mockEvent, randomAlgo, 'test-data')
                    }
                }).not.toThrow()

                if (handlers['crypto:hash']) {
                    await expect(
                        handlers['crypto:hash']({}, randomAlgo, 'test-data')
                    ).resolves.toBeNull()
                }
            }
        })
    })

    describe('FsService Path Sandboxing Fuzzing', () => {
        test('Fuzz: FsService IPC handlers reject arbitrary/unsafe paths without throwing', async () => {
            const fuzzedPaths = [
                '../../etc/passwd',
                '..\\..\\Windows\\System32',
                'C:\\Windows\\System32\\cmd.exe',
                '/etc/passwd',
                '\x00etc/passwd',
                '..',
                '/',
                '\\',
                'valid/path/../../../unsafe',
                'http://localhost',
                '//UNC-path/share',
                'a'.repeat(2000), // Very long path
                null,
                undefined,
                12345
            ]

            for (const unsafePath of fuzzedPaths) {
                // Test fs:readFile handler
                if (handlers['fs:readFile']) {
                    const result = await handlers['fs:readFile']({}, unsafePath)
                    expect(result).toBeNull()
                }

                // Test fs:writeFileSync sync handler
                if (syncHandlers['fs:writeFileSync']) {
                    const mockEvent = { returnValue: null }
                    syncHandlers['fs:writeFileSync'](mockEvent, unsafePath, 'data')
                    expect(mockEvent.returnValue).toBe(false)
                }
            }
        })
    })

    describe('ModService Path Traversal Fuzzing', () => {
        test('Fuzz: ModService functions detect and reject traversal paths', async () => {
            const baseDir = '/mock/mods'
            
            const unsafeForToggle = [
                '../../evil.jar',
                '..\\..\\evil.jar',
                '/absolute/path/evil.jar',
                'C:\\absolute\\path\\evil.jar',
                '\x00evil.jar',
                'valid.jar/../../../evil.jar',
                '..'
            ]

            const unsafeForShader = [
                '../../evil',
                '..\\..\\evil',
                '/absolute/path/evil',
                'C:\\absolute\\path\\evil',
                '..',
                'valid/../../../evil'
            ]

            for (const name of unsafeForToggle) {
                // Test toggleDropinMod (should throw due to assertWithinBase)
                await expect(
                    ModService.toggleDropinMod(baseDir, name, true)
                ).rejects.toThrow()
            }

            for (const name of unsafeForShader) {
                // Test setEnabledShaderpack (should throw due to pack.includes('..') or absolute checks)
                await expect(
                    ModService.setEnabledShaderpack(baseDir, name)
                ).rejects.toThrow()
            }
        })
    })
})
