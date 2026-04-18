const path = require('path')

describe('DropinModUtil', () => {
    let DropinModUtil
    let fs
    let electron

    beforeEach(() => {
        jest.resetModules()
        
        // Mock core/configmanager (required by dropinmodutil)
        // Correct path: tests/unit/app/assets/js/dropinmodutil.test.js -> core/configmanager
        // ../../../../../app/assets/js/core/configmanager
        jest.mock('../../../../../app/assets/js/core/configmanager', () => ({
            SHELL_OPCODE: { TRASH_ITEM: 'TRASH_ITEM' }
        }))

        jest.mock('fs', () => ({
            mkdirSync: jest.fn(),
            existsSync: jest.fn(),
            readdirSync: jest.fn().mockReturnValue([]),
            renameSync: jest.fn(),
            cpSync: jest.fn(),
            rmSync: jest.fn(),
            rename: jest.fn(),
            readFileSync: jest.fn().mockReturnValue(''),
            writeFileSync: jest.fn(),
        }))

        jest.mock('electron', () => ({
            ipcRenderer: {
                invoke: jest.fn().mockResolvedValue({ result: true }),
            },
            shell: {
                beep: jest.fn()
            }
        }))

        DropinModUtil = require('../../../../../app/assets/js/core/dropinmodutil')
        fs = require('fs')
        electron = require('electron')
    })

    it('should validate that the directory exists', () => {
        DropinModUtil.validateDir('test-dir')
        expect(fs.mkdirSync).toHaveBeenCalledWith('test-dir', { recursive: true })
    })

    it('should scan for drop-in mods', () => {
        fs.existsSync.mockReturnValue(true)
        fs.readdirSync.mockReturnValue(['test.jar', 'test.zip.disabled'])
        const mods = DropinModUtil.scanForDropinMods('test-dir', '1.12.2')
        expect(fs.readdirSync).toHaveBeenCalled()
        expect(mods.length).toBeGreaterThan(0)
    })

    it('should delete a drop-in mod', async () => {
        const { ipcRenderer } = require('electron')
        ipcRenderer.invoke.mockResolvedValue({ result: true })
        const result = await DropinModUtil.deleteDropinMod('test-dir', 'test.jar')
        expect(result).toBe(true)
        expect(ipcRenderer.invoke).toHaveBeenCalled()
    })
})
