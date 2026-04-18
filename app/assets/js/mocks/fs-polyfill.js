/**
 * File System Polyfill for the Renderer process.
 * Maps standard Node.js fs calls to the bridge-exposed HeliosAPI.
 */

const fs = {
    promises: {
        readFile: async (path, encoding) => {
            return await window.HeliosAPI?.ipc?.invoke('fs:readFile', path, encoding)
        },
        writeFile: async (path, data, encoding) => {
            return await window.HeliosAPI?.ipc?.invoke('fs:writeFile', path, data, encoding)
        },
        mkdir: async (path, options) => {
            return await window.HeliosAPI?.ipc?.invoke('fs:mkdir', path, options)
        },
        access: async (path, mode) => {
            return await window.HeliosAPI?.ipc?.invoke('fs:access', path, mode)
        },
        stat: async (path) => {
            return await window.HeliosAPI?.ipc?.invoke('fs:stat', path)
        },
        readdir: async (path, options) => {
            return await window.HeliosAPI?.ipc?.invoke('fs:readdir', path, options)
        },
        unlink: async (path) => {
            return await window.HeliosAPI?.ipc?.invoke('fs:unlink', path)
        },
        statfs: async (path) => {
            return await window.HeliosAPI?.ipc?.invoke('fs:statfs', path)
        }
    },
    readFileSync: (path, encoding) => {
        return window.HeliosAPI?.ipc?.sendSync('fs:readFileSync', path, encoding)
    },
    readdirSync: (path, options) => {
        return window.HeliosAPI?.ipc?.sendSync('fs:readdirSync', path, options)
    },
    writeFileSync: (path, data, encoding) => {
        return window.HeliosAPI?.ipc?.sendSync('fs:writeFileSync', path, data, encoding)
    },
    existsSync: (path) => {
        return window.HeliosAPI?.ipc?.sendSync('fs:existsSync', path)
    },
    mkdirSync: (path, options) => {
        return window.HeliosAPI?.ipc?.sendSync('fs:mkdirSync', path, options)
    },
    statSync: (path) => {
        return window.HeliosAPI?.ipc?.sendSync('fs:statSync', path)
    }
}

// Support for 'const fs = require('fs/promises')' pattern
// We add all promises methods to the top level of the exported object
// while keeping the .promises property for 'const fs = require('fs').promises'
const exported = { ...fs, ...fs.promises }

module.exports = exported
