const path = require('path')

describe('DropinModUtil', () => {
    let DropinModUtil
    let electron

    beforeEach(() => {
        jest.resetModules()
        
        jest.mock('electron', () => ({
            ipcRenderer: {
                invoke: jest.fn().mockResolvedValue({ result: true }),
            },
            shell: {
                beep: jest.fn()
            }
        }))

        // Mock core/ipcconstants
        jest.mock('../../../../../app/assets/js/core/ipcconstants', () => ({
            SHELL_OPCODE: { TRASH_ITEM: 'TRASH_ITEM' }
        }))

        // Mock path
        jest.mock('path', () => ({
            join: (...args) => args.join('/')
        }))

        DropinModUtil = require('../../../../../app/assets/js/core/dropinmodutil')
        electron = require('electron')
    })

    it('should scan for drop-in mods', async () => {
        const { ipcRenderer } = require('electron')
        const mockMods = [
            { fullName: 'test.jar', name: 'test', ext: 'jar', disabled: false },
            { fullName: 'test2.jar.disabled', name: 'test2', ext: 'jar', disabled: true }
        ]
        ipcRenderer.invoke.mockResolvedValue(mockMods)

        const mods = await DropinModUtil.scanForDropinMods('test-dir', '1.12.2')
        
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('mods:scan', 'test-dir', '1.12.2')
        expect(mods).toEqual(mockMods)
    })

    it('should delete a drop-in mod', async () => {
        const { ipcRenderer } = require('electron')
        ipcRenderer.invoke.mockResolvedValue({ result: true })
        
        const result = await DropinModUtil.deleteDropinMod('test-dir', 'test.jar')
        
        expect(result).toBe(true)
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('TRASH_ITEM', 'test-dir/test.jar')
    })

    it('should toggle a drop-in mod', async () => {
        const { ipcRenderer } = require('electron')
        ipcRenderer.invoke.mockResolvedValue({ result: true })
        
        await DropinModUtil.toggleDropinMod('test-dir', 'test.jar', false)
        
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('mods:toggle', 'test-dir', 'test.jar', false)
    })

    it('should add drop-in mods', async () => {
        const { ipcRenderer } = require('electron')
        ipcRenderer.invoke.mockResolvedValue({ result: true })
        
        const mockFiles = [
            { name: 'mod1.jar', path: 'C:/downloads/mod1.jar' },
            { name: 'image.png', path: 'C:/downloads/image.png' }
        ]
        
        await DropinModUtil.addDropinMods(mockFiles, 'test-dir')
        
        // Should only add the .jar file
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('mods:add', ['C:/downloads/mod1.jar'], 'test-dir')
    })
})
