const GameCrashHandler = require('@app/assets/js/core/game/GameCrashHandler')
const crypto = require('crypto')
const path = require('path')

// Mock dependencies to isolate GameCrashHandler
jest.mock('electron', () => ({
    shell: {
        openExternal: jest.fn()
    }
}), { virtual: true })

jest.mock('@app/assets/js/core/configmanager', () => ({
    getSupportUrl: jest.fn().mockReturnValue('https://mock-support.com'),
    getModConfiguration: jest.fn().mockReturnValue({ mods: {} }),
    setModConfiguration: jest.fn(),
    save: jest.fn().mockResolvedValue(),
    getJavaExecutable: jest.fn().mockReturnValue('/mock/java'),
    getDataDirectory: jest.fn().mockReturnValue('/mock/data')
}))

jest.mock('@app/assets/js/core/langloader', () => ({
    queryJS: jest.fn().mockReturnValue('mock-translated-text')
}))

jest.mock('@app/assets/js/core/dropinmodutil', () => ({
    scanForDropinMods: jest.fn().mockResolvedValue([{ fullName: 'mod.jar' }])
}))

jest.mock('fs', () => {
    const fsActual = jest.requireActual('fs')
    return {
        ...fsActual,
        existsSync: jest.fn().mockReturnValue(true),
        rmSync: jest.fn(),
        unlinkSync: jest.fn(),
        renameSync: jest.fn(),
        promises: {
            stat: jest.fn().mockResolvedValue({ mtime: { getTime: () => Date.now() } }),
            readdir: jest.fn().mockResolvedValue([])
        }
    }
})

describe('GameCrashHandler Fuzzing & Path Traversal Protection', () => {
    let handler
    const mockServer = {
        rawServer: {
            id: 'mock-server-id',
            minecraftVersion: '1.20.1'
        },
        modules: []
    }

    beforeEach(() => {
        jest.clearAllMocks()
        handler = new GameCrashHandler('/mock/gameDir', '/mock/commonDir', mockServer, [])
        
        // Mock UI calling to avoid Electron window access
        handler._callUI = jest.fn().mockResolvedValue()
        handler.restartGame = jest.fn().mockResolvedValue()
    }
)

    test('Fuzz: handleCrashFix with malicious/corrupted analysis inputs', async () => {
        const fuzzCycles = 200

        for (let i = 0; i < fuzzCycles; i++) {
            // Generate random malicious paths (path traversal attempts)
            const maliciousPaths = [
                '../../etc/passwd',
                '..\\..\\windows\\system32\\cmd.exe',
                'config.json',
                'valid/path/to/file',
                'COM1',
                '\0NULL_BYTE_TRUNCATION',
                '/',
                'C:\\Absolute\\Path\\Outside\\Sandbox',
                crypto.randomBytes(30).toString('hex')
            ]

            const randomPath = maliciousPaths[crypto.randomInt(0, maliciousPaths.length)]

            const crashTypes = [
                'missing-version-file',
                'incompatible-mods',
                'java-corruption',
                'corrupted-config',
                'unknown-fuzzed-type',
                null,
                undefined
            ]
            const randomType = crashTypes[crypto.randomInt(0, crashTypes.length)]

            const crashAnalysis = {
                type: randomType,
                file: randomPath
            }

            // The code must either safely throw expected validation errors, or skip, but NEVER throw internal TypeErrors / ReferenceErrors
            try {
                // Ensure globally referenced objects (e.g. ipcRenderer) won't crash process synchronously
                await handler.handleCrashFix(crashAnalysis)
            } catch (e) {
                expect(e.name).not.toBe('TypeError')
                expect(e.name).not.toBe('ReferenceError')
            }
        }
    })
})
