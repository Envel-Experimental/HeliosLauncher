const { ipcMain } = require('electron')
const fs = require('fs/promises')
const fsSync = require('fs')
const path = require('path')
const ConfigManager = require('../assets/js/core/configmanager')

const MOD_REGEX = /^(.+(jar|zip|litemod))(?:\.(disabled))?$/
const DISABLED_EXT = '.disabled'
const SHADER_REGEX = /^(.+)\.zip$/
const SHADER_OPTION = /shaderPack=(.+)/
const SHADER_DIR = 'shaderpacks'
const SHADER_CONFIG = 'optionsshaders.txt'

/**
 * Ensures that `targetPath` stays within `baseDir`.
 * Returns the resolved absolute path on success, throws on traversal.
 * @param {string} baseDir
 * @param {string} targetPath
 * @returns {string}
 */
function assertWithinBase(baseDir, targetPath) {
    const resolvedBase = path.resolve(baseDir)
    const resolved = path.resolve(baseDir, targetPath)
    if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
        throw new Error(`Path traversal detected: "${targetPath}" escapes base directory`)
    }
    return resolved
}

/**
 * Returns the instance directory root (launcher dir + /instances).
 * Used to validate instanceDir paths passed from renderer.
 * @returns {string}
 */
function getInstancesRoot() {
    return ConfigManager.getInstanceDirectorySync
        ? ConfigManager.getInstanceDirectorySync()
        : path.join(ConfigManager.getLauncherDirectorySync(), 'instances')
}

class ModService {
    init() {
        // Mods
        ipcMain.handle('mods:scan', async (event, modsDir, version) => {
            return this.scanForDropinMods(modsDir, version)
        })

        ipcMain.handle('mods:add', async (event, filePaths, modsDir) => {
            return this.addDropinMods(filePaths, modsDir)
        })

        ipcMain.handle('mods:toggle', async (event, modsDir, fullName, enable) => {
            return this.toggleDropinMod(modsDir, fullName, enable)
        })

        // Shaders
        ipcMain.handle('shaders:scan', async (event, instanceDir) => {
            return this.scanForShaderpacks(instanceDir)
        })

        ipcMain.handle('shaders:getEnabled', async (event, instanceDir) => {
            return this.getEnabledShaderpack(instanceDir)
        })

        ipcMain.handle('shaders:setEnabled', async (event, instanceDir, pack) => {
            return this.setEnabledShaderpack(instanceDir, pack)
        })

        ipcMain.handle('shaders:add', async (event, filePaths, instanceDir) => {
            return this.addShaderpacks(filePaths, instanceDir)
        })
    }

    async scanForDropinMods(modsDir, version) {
        const modsDiscovered = []
        if (fsSync.existsSync(modsDir)) {
            let modCandidates = await fs.readdir(modsDir)
            let verCandidates = []
            const versionDir = path.join(modsDir, version)
            if (fsSync.existsSync(versionDir)) {
                verCandidates = await fs.readdir(versionDir)
            }
            for (let file of modCandidates) {
                const match = MOD_REGEX.exec(file)
                if (match != null) {
                    modsDiscovered.push({
                        fullName: match[0],
                        name: match[1],
                        ext: match[2],
                        disabled: match[3] != null
                    })
                }
            }
            for (let file of verCandidates) {
                const match = MOD_REGEX.exec(file)
                if (match != null) {
                    modsDiscovered.push({
                        fullName: path.join(version, match[0]),
                        name: match[1],
                        ext: match[2],
                        disabled: match[3] != null
                    })
                }
            }
        }
        return modsDiscovered
    }

    async addDropinMods(filePaths, modsDir) {
        await fs.mkdir(modsDir, { recursive: true })

        if (!Array.isArray(filePaths)) return false

        for (let filePath of filePaths) {
            if (typeof filePath !== 'string') continue
            const fileName = path.basename(filePath)
            if (MOD_REGEX.exec(fileName) != null) {
                // Destination must stay within modsDir
                const destPath = assertWithinBase(modsDir, fileName)
                try {
                    await fs.rename(filePath, destPath)
                } catch (err) {
                    if (err.code === 'EXDEV') {
                        await fs.copyFile(filePath, destPath)
                        await fs.unlink(filePath)
                    } else {
                        throw err
                    }
                }
            }
        }
        return true
    }

    async toggleDropinMod(modsDir, fullName, enable) {
        if (typeof fullName !== 'string') throw new Error('Invalid fullName')

        // Security: ensure we stay within modsDir
        const oldPath = assertWithinBase(modsDir, fullName)

        const baseName = enable
            ? fullName.substring(0, fullName.indexOf(DISABLED_EXT))
            : fullName + DISABLED_EXT
        const newPath = assertWithinBase(modsDir, baseName)

        await fs.rename(oldPath, newPath)
        return true
    }

    async scanForShaderpacks(instanceDir) {
        const sDir = path.join(instanceDir, SHADER_DIR)
        const packsDiscovered = [{
            fullName: 'OFF',
            name: 'Off (Default)'
        }]
        if (fsSync.existsSync(sDir)) {
            let modCandidates = await fs.readdir(sDir)
            for (let file of modCandidates) {
                const match = SHADER_REGEX.exec(file)
                if (match != null) {
                    packsDiscovered.push({
                        fullName: match[0],
                        name: match[1]
                    })
                }
            }
        }
        return packsDiscovered
    }

    async getEnabledShaderpack(instanceDir) {
        const optionsShaders = path.join(instanceDir, SHADER_CONFIG)
        if (fsSync.existsSync(optionsShaders)) {
            const buf = await fs.readFile(optionsShaders, { encoding: 'utf-8' })
            const match = SHADER_OPTION.exec(buf)
            if (match != null) {
                return match[1]
            }
        }
        return 'OFF'
    }

    async setEnabledShaderpack(instanceDir, pack) {
        if (typeof pack !== 'string') throw new Error('Invalid pack name')
        // Validate pack is just a filename (no traversal)
        if (pack !== 'OFF' && (pack.includes('..') || path.isAbsolute(pack))) {
            throw new Error('Invalid shader pack name')
        }

        await fs.mkdir(instanceDir, { recursive: true })
        const optionsShaders = path.join(instanceDir, SHADER_CONFIG)
        let buf
        if (fsSync.existsSync(optionsShaders)) {
            buf = await fs.readFile(optionsShaders, { encoding: 'utf-8' })
            buf = buf.replace(SHADER_OPTION, `shaderPack=${pack}`)
        } else {
            buf = `shaderPack=${pack}`
        }
        await fs.writeFile(optionsShaders, buf, { encoding: 'utf-8' })
        return true
    }

    async addShaderpacks(filePaths, instanceDir) {
        const p = path.join(instanceDir, SHADER_DIR)
        await fs.mkdir(p, { recursive: true })

        if (!Array.isArray(filePaths)) return false

        for (let filePath of filePaths) {
            if (typeof filePath !== 'string') continue
            const fileName = path.basename(filePath)
            if (SHADER_REGEX.exec(fileName) != null) {
                const destPath = assertWithinBase(p, fileName)
                try {
                    await fs.rename(filePath, destPath)
                } catch (err) {
                    if (err.code === 'EXDEV') {
                        await fs.copyFile(filePath, destPath)
                        await fs.unlink(filePath)
                    } else {
                        throw err
                    }
                }
            }
        }
        return true
    }
}

module.exports = new ModService()
