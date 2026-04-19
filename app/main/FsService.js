const { ipcMain } = require('electron')
const fs = require('fs/promises')
const { constants } = require('fs')

class FsService {
    init() {

        ipcMain.handle('fs:readFile', async (event, path, opts) => {
            try {
                return await fs.readFile(path, opts)
            } catch (e) {
                return null
            }
        })

        ipcMain.handle('fs:writeFile', async (event, path, data, opts) => {
            try {
                await fs.writeFile(path, data, opts)
                return true
            } catch (e) {
                return false
            }
        })

        ipcMain.handle('fs:mkdir', async (event, path, opts) => {
            try {
                await fs.mkdir(path, opts)
                return true
            } catch (e) {
                return false
            }
        })

        ipcMain.handle('fs:access', async (event, path, mode) => {
            try {
                await fs.access(path, mode)
                return true
            } catch (e) {
                return false
            }
        })

        ipcMain.handle('fs:readdir', async (event, path, opts) => {
            try {
                return await fs.readdir(path, opts)
            } catch (e) {
                return []
            }
        })

        ipcMain.handle('fs:rm', async (event, path, opts) => {
            return await fs.rm(path, opts)
        })

        ipcMain.handle('fs:rename', async (event, path, newPath) => {
            return await fs.rename(path, newPath)
        })

        ipcMain.handle('fs:stat', async (event, path) => {
            const stats = await fs.stat(path)
            return {
                isDirectory: stats.isDirectory(),
                isFile: stats.isFile(),
                size: stats.size,
                mtimeMs: stats.mtimeMs
            }
        })

        ipcMain.handle('fs:statfs', async (event, path) => {
            return await fs.statfs(path)
        })

        // Synchronous Handlers
        ipcMain.on('fs:readFileSync', (event, path, opts) => {
            try {
                const fsSync = require('fs')
                event.returnValue = fsSync.readFileSync(path, opts)
            } catch (e) {
                event.returnValue = null
            }
        })

        ipcMain.on('fs:writeFileSync', (event, path, data, opts) => {
            try {
                const fsSync = require('fs')
                fsSync.writeFileSync(path, data, opts)
                event.returnValue = true
            } catch (e) {
                event.returnValue = false
            }
        })

        ipcMain.on('fs:existsSync', (event, path) => {
            const fsSync = require('fs')
            event.returnValue = fsSync.existsSync(path)
        })

        ipcMain.on('fs:accessSync', (event, path, mode) => {
            try {
                const fsSync = require('fs')
                fsSync.accessSync(path, mode)
                event.returnValue = true
            } catch (e) {
                event.returnValue = false
            }
        })

        ipcMain.on('fs:mkdirSync', (event, path, opts) => {
            try {
                const fsSync = require('fs')
                fsSync.mkdirSync(path, opts)
                event.returnValue = true
            } catch (e) {
                event.returnValue = false
            }
        })

        ipcMain.on('fs:readdirSync', (event, path, opts) => {
            try {
                const fsSync = require('fs')
                event.returnValue = fsSync.readdirSync(path, opts)
            } catch (e) {
                event.returnValue = []
            }
        })

        ipcMain.on('fs:rmSync', (event, path, opts) => {
            try {
                const fsSync = require('fs')
                fsSync.rmSync(path, opts)
                event.returnValue = true
            } catch (e) {
                event.returnValue = false
            }
        })

        ipcMain.on('fs:unlinkSync', (event, path) => {
            try {
                const fsSync = require('fs')
                fsSync.unlinkSync(path)
                event.returnValue = true
            } catch (e) {
                event.returnValue = false
            }
        })

        ipcMain.on('fs:renameSync', (event, path, newPath) => {
            try {
                const fsSync = require('fs')
                fsSync.renameSync(path, newPath)
                event.returnValue = true
            } catch (e) {
                event.returnValue = false
            }
        })
    }
}

module.exports = new FsService()
