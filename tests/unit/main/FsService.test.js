// Mock electron ipcMain + app.getAppPath
// Note: jest.mock is hoisted, but the factory function runs lazily —
// __dirname is available because it's a CommonJS-scope variable.
jest.mock('electron', () => {
    const p = require('path')
    const appRoot = p.resolve(__dirname, '../../..')
    return {
        ipcMain: {
            handle: jest.fn(),
            on: jest.fn()
        },
        app: {
            getAppPath: jest.fn().mockReturnValue(appRoot)
        }
    }
})

// Mock fs and fs/promises
jest.mock('fs/promises', () => ({
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    access: jest.fn(),
    readdir: jest.fn(),
    rm: jest.fn(),
    rename: jest.fn(),
    stat: jest.fn(),
    statfs: jest.fn()
}))

jest.mock('fs', () => ({
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    existsSync: jest.fn(),
    accessSync: jest.fn(),
    mkdirSync: jest.fn(),
    readdirSync: jest.fn(),
    rmSync: jest.fn(),
    unlinkSync: jest.fn(),
    renameSync: jest.fn(),
    constants: {
        F_OK: 0
    }
}))

jest.mock('../../../app/assets/js/core/util', () => ({
    retry: jest.fn(async (fn) => await fn())
}))

const path = require('path')
const os = require('os')

// APP_ROOT = the app installation dir (readable, not writable)
const APP_ROOT = path.resolve(__dirname, '../../..')
// SANDBOX_ROOT = user data dir (readable + writable)
const mockSandboxRoot = path.join(os.tmpdir(), `helios_fs_test_${Date.now()}`)

jest.mock('../../../app/assets/js/core/configmanager', () => ({
    getLauncherDirectorySync: jest.fn().mockReturnValue(mockSandboxRoot),
    getDataDirectory: jest.fn().mockReturnValue(mockSandboxRoot)
}))

const FsService = require('../../../app/main/FsService')
const { ipcMain } = require('electron')
const fs = require('fs/promises')
const fsSync = require('fs')

// Test paths in both allowed zones
const TEST_PATH = path.join(mockSandboxRoot, 'test-file.txt')        // writable data dir
const TEST_PATH2 = path.join(mockSandboxRoot, 'test-file2.txt')
const APP_ASSET_PATH = path.join(APP_ROOT, 'app', 'assets', 'lang', 'en_US.toml')  // app assets — read only

describe('FsService', () => {
    
    beforeEach(() => {
        jest.clearAllMocks()
        FsService.init()
    })

    const getHandler = (channel) => {
        const call = ipcMain.handle.mock.calls.find(c => c[0] === channel)
        return call ? call[1] : null
    }

    const getOnHandler = (channel) => {
        const call = ipcMain.on.mock.calls.find(c => c[0] === channel)
        return call ? call[1] : null
    }

    describe('Async Handlers', () => {
        it('fs:readFile should return data or null', async () => {
            const h = getHandler('fs:readFile')
            fs.readFile.mockResolvedValue('ok')
            expect(await h({}, TEST_PATH)).toBe('ok')
            fs.readFile.mockRejectedValue(new Error())
            expect(await h({}, TEST_PATH)).toBeNull()
        })

        it('fs:writeFile should return true or false', async () => {
            const h = getHandler('fs:writeFile')
            fs.writeFile.mockResolvedValue()
            expect(await h({}, TEST_PATH, 'd')).toBe(true)
            fs.writeFile.mockRejectedValue(new Error())
            expect(await h({}, TEST_PATH, 'd')).toBe(false)
        })

        it('fs:mkdir should return true or false', async () => {
            const h = getHandler('fs:mkdir')
            fs.mkdir.mockResolvedValue()
            expect(await h({}, TEST_PATH)).toBe(true)
            fs.mkdir.mockRejectedValue(new Error())
            expect(await h({}, TEST_PATH)).toBe(false)
        })

        it('fs:access should return true or false', async () => {
            const h = getHandler('fs:access')
            fs.access.mockResolvedValue()
            expect(await h({}, TEST_PATH)).toBe(true)
            fs.access.mockRejectedValue(new Error())
            expect(await h({}, TEST_PATH)).toBe(false)
        })

        it('fs:readdir should return list or empty', async () => {
            const h = getHandler('fs:readdir')
            fs.readdir.mockResolvedValue(['a'])
            expect(await h({}, TEST_PATH)).toEqual(['a'])
            fs.readdir.mockRejectedValue(new Error())
            expect(await h({}, TEST_PATH)).toEqual([])
        })

        it('fs:statfs should call fs.statfs', async () => {
            const h = getHandler('fs:statfs')
            fs.statfs.mockResolvedValue({ available: 100 })
            expect(await h({}, TEST_PATH)).toEqual({ available: 100 })
        })

        it('fs:rm and fs:rename should use retry', async () => {
            const hRm = getHandler('fs:rm')
            fs.rm.mockResolvedValue()
            await hRm({}, TEST_PATH)
            expect(fs.rm).toHaveBeenCalled()

            const hRen = getHandler('fs:rename')
            fs.rename.mockResolvedValue()
            await hRen({}, TEST_PATH, TEST_PATH2)
            expect(fs.rename).toHaveBeenCalled()
        })
    })

    describe('Path Sandbox', () => {
        it('should reject paths outside sandbox', async () => {
            const h = getHandler('fs:readFile')
            // Path outside sandbox should return null (rejected)
            const result = await h({}, '/outside/root/secret.txt')
            expect(result).toBeNull()
            expect(fs.readFile).not.toHaveBeenCalled()
        })

        it('should reject null/invalid paths', async () => {
            const h = getHandler('fs:readFile')
            expect(await h({}, null)).toBeNull()
            expect(await h({}, '')).toBeNull()
        })
    })

    describe('Sync Handlers', () => {
        it('should handle all sync methods and their errors', () => {
            const methods = [
                ['fs:readFileSync', fsSync.readFileSync, 'res', null],
                ['fs:writeFileSync', fsSync.writeFileSync, true, false],
                ['fs:accessSync', fsSync.accessSync, true, false],
                ['fs:mkdirSync', fsSync.mkdirSync, true, false],
                ['fs:readdirSync', fsSync.readdirSync, ['a'], []],
                ['fs:rmSync', fsSync.rmSync, true, false],
                ['fs:unlinkSync', fsSync.unlinkSync, true, false],
                ['fs:renameSync', fsSync.renameSync, true, false]
            ]

            methods.forEach(([channel, mockFn, successRes, failRes]) => {
                const h = getOnHandler(channel)
                const event = {}
                
                // Success
                mockFn.mockReturnValue(successRes === true ? undefined : successRes)
                h(event, TEST_PATH, TEST_PATH2)
                expect(event.returnValue).toEqual(successRes)

                // Error
                mockFn.mockImplementation(() => { throw new Error() })
                h(event, TEST_PATH, TEST_PATH2)
                expect(event.returnValue).toEqual(failRes)
            })
        })
    })
})




