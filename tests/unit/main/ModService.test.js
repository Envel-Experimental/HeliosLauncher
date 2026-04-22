// Mock electron ipcMain
jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
        on: jest.fn()
    }
}))

// Mock fs and fs/promises
jest.mock('fs/promises', () => ({
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    readdir: jest.fn(),
    rm: jest.fn(),
    rename: jest.fn(),
    copyFile: jest.fn(),
    unlink: jest.fn()
}))

jest.mock('fs', () => ({
    existsSync: jest.fn()
}))

const ModService = require('../../../app/main/ModService')
const { ipcMain } = require('electron')
const fs = require('fs/promises')
const fsSync = require('fs')
const path = require('path')

describe('ModService', () => {
    
    beforeEach(() => {
        jest.clearAllMocks()
        ModService.init()
    })

    describe('Mod Scanning', () => {
        it('should scan for mods in main and version directories', async () => {
            fsSync.existsSync.mockReturnValue(true)
            fs.readdir.mockResolvedValueOnce(['mod1.jar', 'mod2.zip.disabled', 'notamod.txt'])
            fs.readdir.mockResolvedValueOnce(['vermod.jar'])

            const result = await ModService.scanForDropinMods('/mods', '1.20.1')

            expect(result).toHaveLength(3)
            expect(result[0]).toEqual({
                fullName: 'mod1.jar',
                name: 'mod1.jar',
                ext: 'jar',
                disabled: false
            })
            expect(result[1]).toEqual({
                fullName: 'mod2.zip.disabled',
                name: 'mod2.zip',
                ext: 'zip',
                disabled: true
            })
            expect(result[2]).toEqual({
                fullName: path.join('1.20.1', 'vermod.jar'),
                name: 'vermod.jar',
                ext: 'jar',
                disabled: false
            })
        })
    })

    describe('Mod Management', () => {
        it('should add dropin mods by renaming or copying if EXDEV', async () => {
            fs.mkdir.mockResolvedValue()
            fs.rename.mockResolvedValueOnce() // First mod success
            fs.rename.mockRejectedValueOnce({ code: 'EXDEV' }) // Second mod fail
            fs.copyFile.mockResolvedValue()
            fs.unlink.mockResolvedValue()

            const result = await ModService.addDropinMods(['/tmp/mod1.jar', '/tmp/mod2.jar'], '/mods')
            
            expect(result).toBe(true)
            expect(fs.mkdir).toHaveBeenCalledWith('/mods', { recursive: true })
            expect(fs.rename).toHaveBeenCalledWith('/tmp/mod1.jar', path.join('/mods', 'mod1.jar'))
            expect(fs.copyFile).toHaveBeenCalledWith('/tmp/mod2.jar', path.join('/mods', 'mod2.jar'))
            expect(fs.unlink).toHaveBeenCalledWith('/tmp/mod2.jar')
        })
    })

    describe('Mod Toggling', () => {
        it('should disable an enabled mod', async () => {
            await ModService.toggleDropinMod('/mods', 'mod.jar', false)
            expect(fs.rename).toHaveBeenCalledWith(
                path.join('/mods', 'mod.jar'),
                path.join('/mods', 'mod.jar.disabled')
            )
        })

        it('should enable a disabled mod', async () => {
            await ModService.toggleDropinMod('/mods', 'mod.jar.disabled', true)
            expect(fs.rename).toHaveBeenCalledWith(
                path.join('/mods', 'mod.jar.disabled'),
                path.join('/mods', 'mod.jar')
            )
        })
    })

    describe('Shader Scanning', () => {
        it('should scan for shaderpacks and include OFF option', async () => {
            fsSync.existsSync.mockReturnValue(true)
            fs.readdir.mockResolvedValue(['shader1.zip', 'shader2.zip'])

            const result = await ModService.scanForShaderpacks('/instance')

            expect(result).toHaveLength(3)
            expect(result[0].fullName).toBe('OFF')
            expect(result[1].name).toBe('shader1')
        })
    })

    describe('Shader Configuration', () => {
        it('should get enabled shaderpack from config', async () => {
            fsSync.existsSync.mockReturnValue(true)
            fs.readFile.mockResolvedValue('shaderPack=TestShader')

            const result = await ModService.getEnabledShaderpack('/instance')
            expect(result).toBe('TestShader')
        })

        it('should update shaderpack in config', async () => {
            fsSync.existsSync.mockReturnValue(true)
            fs.readFile.mockResolvedValue('otherOption=true\nshaderPack=OldShader')
            
            await ModService.setEnabledShaderpack('/instance', 'NewShader')
            
            expect(fs.writeFile).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('shaderPack=NewShader'),
                expect.any(Object)
            )
        })
    })
})
