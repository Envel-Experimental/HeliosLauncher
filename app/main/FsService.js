const { ipcMain, app } = require('electron')
const fs = require('fs/promises')
const path = require('path')
const { retry } = require('../assets/js/core/util')

/**
 * Returns directories the renderer is allowed to READ FROM.
 * Includes the app installation dir (for bundled assets like lang files)
 * AND the user data dir (for config, mods, etc.)
 * @returns {string[]}
 */
function getReadRoots() {
    const roots = []

    // App installation dir — bundled assets (lang files, etc.) — READ ONLY
    try {
        const appPath = app.getAppPath()
        if (appPath) roots.push(path.resolve(appPath))
    } catch { /* app not ready */ }

    // User data dirs — READ + WRITE
    roots.push(...getWriteRoots())

    return [...new Set(roots)]
}

/**
 * Returns directories the renderer is allowed to WRITE TO.
 * Strictly limited to the launcher's user-data directory.
 * @returns {string[]}
 */
function getWriteRoots() {
    const ConfigManager = require('../assets/js/core/configmanager')
    const roots = []
    try {
        const launcherDir = ConfigManager.getLauncherDirectorySync()
        if (launcherDir) roots.push(path.resolve(launcherDir))
    } catch { /* not yet initialised */ }
    try {
        const dataDir = ConfigManager.getDataDirectory()
        if (dataDir) roots.push(path.resolve(dataDir))
    } catch { /* not yet initialised */ }
    return [...new Set(roots)]
}

/**
 * Validates that `targetPath` resolves within an allowed root.
 * @param {string} targetPath
 * @param {'read'|'write'} mode - 'read' allows app dir; 'write' requires user data dir
 * @returns {string|null} resolved path on success, null on violation
 */
function sandboxPath(targetPath, mode = 'write') {
    if (typeof targetPath !== 'string' || !targetPath || targetPath.includes('\0')) return null

    let resolved
    try {
        resolved = path.resolve(targetPath)
    } catch {
        return null
    }

    const roots = mode === 'read' ? getReadRoots() : getWriteRoots()
    // If no roots available — fail safe (deny all)
    if (roots.length === 0) return null

    for (const root of roots) {
        if (resolved === root || resolved.startsWith(root + path.sep)) {
            return resolved
        }
    }
    return null
}

class FsService {
    init() {

        ipcMain.handle('fs:readFile', async (event, targetPath, opts) => {
            const safe = sandboxPath(targetPath, 'read')
            if (!safe) return null
            try {
                return await fs.readFile(safe, opts)
            } catch {
                return null
            }
        })

        ipcMain.handle('fs:writeFile', async (event, targetPath, data, opts) => {
            const safe = sandboxPath(targetPath)
            if (!safe) return false
            try {
                await fs.writeFile(safe, data, opts)
                return true
            } catch {
                return false
            }
        })

        ipcMain.handle('fs:mkdir', async (event, targetPath, opts) => {
            const safe = sandboxPath(targetPath)
            if (!safe) return false
            try {
                await fs.mkdir(safe, opts)
                return true
            } catch {
                return false
            }
        })

        ipcMain.handle('fs:access', async (event, targetPath, mode) => {
            const safe = sandboxPath(targetPath, 'read')
            if (!safe) return false
            try {
                await fs.access(safe, mode)
                return true
            } catch {
                return false
            }
        })

        ipcMain.handle('fs:readdir', async (event, targetPath, opts) => {
            const safe = sandboxPath(targetPath, 'read')
            if (!safe) return []
            try {
                return await fs.readdir(safe, opts)
            } catch {
                return []
            }
        })

        ipcMain.handle('fs:rm', async (event, targetPath, opts) => {
            const safe = sandboxPath(targetPath)
            if (!safe) return false
            return await retry(async () => {
                return await fs.rm(safe, opts)
            }, 5, 100, (err) => err.code === 'EPERM' || err.code === 'EBUSY')
        })

        ipcMain.handle('fs:rmdir', async (event, targetPath, opts) => {
            const safe = sandboxPath(targetPath)
            if (!safe) return false
            return await retry(async () => {
                return await fs.rmdir(safe, opts)
            }, 5, 100, (err) => err.code === 'EPERM' || err.code === 'EBUSY')
        })

        ipcMain.handle('fs:unlink', async (event, targetPath) => {
            const safe = sandboxPath(targetPath)
            if (!safe) return false
            return await retry(async () => {
                return await fs.unlink(safe)
            }, 5, 100, (err) => err.code === 'EPERM' || err.code === 'EBUSY')
        })

        ipcMain.handle('fs:rename', async (event, targetPath, newPath) => {
            const safe = sandboxPath(targetPath)
            const safeDest = sandboxPath(newPath)
            if (!safe || !safeDest) return false
            return await retry(async () => {
                return await fs.rename(safe, safeDest)
            }, 5, 100, (err) => err.code === 'EPERM' || err.code === 'EBUSY')
        })

        ipcMain.handle('fs:stat', async (event, targetPath) => {
            const safe = sandboxPath(targetPath, 'read')
            if (!safe) return null
            try {
                const stats = await fs.stat(safe)
                return {
                    isDirectory: stats.isDirectory(),
                    isFile: stats.isFile(),
                    size: stats.size || 0,
                    mtimeMs: stats.mtimeMs || Date.now()
                }
            } catch {
                return null
            }
        })

        ipcMain.handle('fs:statfs', async (event, targetPath) => {
            const safe = sandboxPath(targetPath, 'read')
            if (!safe) return null
            return await fs.statfs(safe)
        })

        // Synchronous Handlers
        ipcMain.on('fs:readFileSync', (event, targetPath, opts) => {
            const safe = sandboxPath(targetPath, 'read')
            if (!safe) { event.returnValue = null; return }
            try {
                const fsSync = require('fs')
                event.returnValue = fsSync.readFileSync(safe, opts)
            } catch {
                event.returnValue = null
            }
        })

        ipcMain.on('fs:writeFileSync', (event, targetPath, data, opts) => {
            const safe = sandboxPath(targetPath)
            if (!safe) { event.returnValue = false; return }
            try {
                const fsSync = require('fs')
                fsSync.writeFileSync(safe, data, opts)
                event.returnValue = true
            } catch {
                event.returnValue = false
            }
        })

        ipcMain.on('fs:existsSync', (event, targetPath) => {
            const safe = sandboxPath(targetPath, 'read')
            if (!safe) { event.returnValue = false; return }
            const fsSync = require('fs')
            event.returnValue = fsSync.existsSync(safe)
        })

        ipcMain.on('fs:accessSync', (event, targetPath, mode) => {
            const safe = sandboxPath(targetPath, 'read')
            if (!safe) { event.returnValue = false; return }
            try {
                const fsSync = require('fs')
                fsSync.accessSync(safe, mode)
                event.returnValue = true
            } catch {
                event.returnValue = false
            }
        })

        ipcMain.on('fs:mkdirSync', (event, targetPath, opts) => {
            const safe = sandboxPath(targetPath)
            if (!safe) { event.returnValue = false; return }
            try {
                const fsSync = require('fs')
                fsSync.mkdirSync(safe, opts)
                event.returnValue = true
            } catch {
                event.returnValue = false
            }
        })

        ipcMain.on('fs:readdirSync', (event, targetPath, opts) => {
            const safe = sandboxPath(targetPath, 'read')
            if (!safe) { event.returnValue = []; return }
            try {
                const fsSync = require('fs')
                event.returnValue = fsSync.readdirSync(safe, opts)
            } catch {
                event.returnValue = []
            }
        })

        ipcMain.on('fs:rmSync', (event, targetPath, opts) => {
            const safe = sandboxPath(targetPath)
            if (!safe) { event.returnValue = false; return }
            try {
                const fsSync = require('fs')
                fsSync.rmSync(safe, opts)
                event.returnValue = true
            } catch {
                event.returnValue = false
            }
        })

        ipcMain.on('fs:unlinkSync', (event, targetPath) => {
            const safe = sandboxPath(targetPath)
            if (!safe) { event.returnValue = false; return }
            try {
                const fsSync = require('fs')
                fsSync.unlinkSync(safe)
                event.returnValue = true
            } catch {
                event.returnValue = false
            }
        })

        ipcMain.on('fs:renameSync', (event, targetPath, newPath) => {
            const safe = sandboxPath(targetPath)
            const safeDest = sandboxPath(newPath)
            if (!safe || !safeDest) { event.returnValue = false; return }
            try {
                const fsSync = require('fs')
                fsSync.renameSync(safe, safeDest)
                event.returnValue = true
            } catch {
                event.returnValue = false
            }
        })
    }
}

module.exports = new FsService()
