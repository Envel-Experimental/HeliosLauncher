const { ipcMain } = require('electron')
const fs = require('fs/promises')
const { constants } = require('fs')

class FsService {
    init() {

        ipcMain.handle('fs:readFile', async (event, path, opts) => {
            return await fs.readFile(path, opts)
        })

        ipcMain.handle('fs:writeFile', async (event, path, data, opts) => {
            return await fs.writeFile(path, data, opts)
        })

        ipcMain.handle('fs:mkdir', async (event, path, opts) => {
            return await fs.mkdir(path, opts)
        })

        ipcMain.handle('fs:access', async (event, path, mode) => {
            return await fs.access(path, mode)
        })

        ipcMain.handle('fs:readdir', async (event, path, opts) => {
            return await fs.readdir(path, opts)
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
    }
}

module.exports = new FsService()
