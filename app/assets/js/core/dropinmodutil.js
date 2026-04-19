const { ipcRenderer, shell } = require('electron')
const { SHELL_OPCODE } = require('./ipcconstants')
const path = require('path')

// Group #1: File Name (without .disabled, if any)
// Group #2: File Extension (jar, zip, or litemod)
// Group #3: If it is disabled (if string 'disabled' is present)
const MOD_REGEX = /^(.+(jar|zip|litemod))(?:\.(disabled))?$/
const DISABLED_EXT = '.disabled'

const SHADER_REGEX = /^(.+)\.zip$/

/**
 * Scan for drop-in mods in both the mods folder and version
 * safe mods folder.
 *
 * @param {string} modsDir The path to the mods directory.
 * @param {string} version The minecraft version of the server configuration.
 *
 * @returns {Promise<{fullName: string, name: string, ext: string, disabled: boolean}[]>}
 * An array of objects storing metadata about each discovered mod.
 */
exports.scanForDropinMods = async function (modsDir, version) {
    return await ipcRenderer.invoke('mods:scan', modsDir, version)
}

/**
 * Add dropin mods.
 *
 * @param {FileList} files The files to add.
 * @param {string} modsDir The path to the mods directory.
 */
exports.addDropinMods = async function (files, modsDir) {
    const paths = Array.from(files).filter(f => f.path && MOD_REGEX.exec(f.name) != null).map(f => f.path)
    if (paths.length > 0) {
        return await ipcRenderer.invoke('mods:add', paths, modsDir)
    }
}

/**
 * Delete a drop-in mod from the file system.
 *
 * @param {string} modsDir The path to the mods directory.
 * @param {string} fullName The fullName of the discovered mod to delete.
 *
 * @returns {Promise.<boolean>} True if the mod was deleted, otherwise false.
 */
exports.deleteDropinMod = async function (modsDir, fullName) {
    const res = await ipcRenderer.invoke(SHELL_OPCODE.TRASH_ITEM, path.join(modsDir, fullName))

    if (!res.result) {
        shell.beep()
        console.error('Error deleting drop-in mod.', res.error)
        return false
    }

    return true
}

/**
 * Toggle a discovered mod on or off. This is achieved by either
 * adding or disabling the .disabled extension to the local file.
 *
 * @param {string} modsDir The path to the mods directory.
 * @param {string} fullName The fullName of the discovered mod to toggle.
 * @param {boolean} enable Whether to toggle on or off the mod.
 *
 * @returns {Promise.<void>} A promise which resolves when the mod has
 * been toggled. If an IO error occurs the promise will be rejected.
 */
exports.toggleDropinMod = async function (modsDir, fullName, enable) {
    return await ipcRenderer.invoke('mods:toggle', modsDir, fullName, enable)
}

/**
 * Check if a drop-in mod is enabled.
 *
 * @param {string} fullName The fullName of the discovered mod to toggle.
 * @returns {boolean} True if the mod is enabled, otherwise false.
 */
exports.isDropinModEnabled = function (fullName) {
    return !fullName.endsWith(DISABLED_EXT)
}

/**
 * Scan for shaderpacks inside the shaderpacks folder.
 *
 * @param {string} instanceDir The path to the server instance directory.
 *
 * @returns {Promise<{fullName: string, name: string}[]>}
 * An array of objects storing metadata about each discovered shaderpack.
 */
exports.scanForShaderpacks = async function (instanceDir) {
    return await ipcRenderer.invoke('shaders:scan', instanceDir)
}

/**
 * Read the optionsshaders.txt file to locate the current
 * enabled pack. If the file does not exist, OFF is returned.
 *
 * @param {string} instanceDir The path to the server instance directory.
 *
 * @returns {Promise<string>} The file name of the enabled shaderpack.
 */
exports.getEnabledShaderpack = async function (instanceDir) {
    return await ipcRenderer.invoke('shaders:getEnabled', instanceDir)
}

/**
 * Set the enabled shaderpack.
 *
 * @param {string} instanceDir The path to the server instance directory.
 * @param {string} pack the file name of the shaderpack.
 */
exports.setEnabledShaderpack = async function (instanceDir, pack) {
    return await ipcRenderer.invoke('shaders:setEnabled', instanceDir, pack)
}

/**
 * Add shaderpacks.
 *
 * @param {FileList} files The files to add.
 * @param {string} instanceDir The path to the server instance directory.
 */
exports.addShaderpacks = async function (files, instanceDir) {
    const paths = Array.from(files).filter(f => f.path && SHADER_REGEX.exec(f.name) != null).map(f => f.path)
    if (paths.length > 0) {
        return await ipcRenderer.invoke('shaders:add', paths, instanceDir)
    }
}
