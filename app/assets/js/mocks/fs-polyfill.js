/**
 * File System Polyfill for the Renderer process.
 * Maps standard Node.js fs calls to the bridge-exposed HeliosAPI.
 */

const fs = {
    promises: {
        readFile: async (path, encoding) => {
            const res = await window.HeliosAPI?.ipc?.invoke('fs:readFile', path, encoding)
            if (res === null) throw new Error(`ENOENT: no such file or directory, readFile '${path}'`)
            return res
        },
        writeFile: async (path, data, encoding) => {
            return await window.HeliosAPI?.ipc?.invoke('fs:writeFile', path, data, encoding)
        },
        mkdir: async (path, options) => {
            return await window.HeliosAPI?.ipc?.invoke('fs:mkdir', path, options)
        },
        access: async (path, mode) => {
            const res = await window.HeliosAPI?.ipc?.invoke('fs:access', path, mode)
            if (!res) throw new Error(`ENOENT: no such file or directory, access '${path}'`)
            return res
        },
        stat: async (path) => {
            // Robust stat with retry for race conditions
            for (let i = 0; i < 3; i++) {
                try {
                    const res = await window.HeliosAPI?.ipc?.invoke('fs:stat', path)
                    if (res) return res
                } catch (e) {
                    if (i === 2) throw e
                }
                await new Promise(r => setTimeout(r, 50))
            }
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
    },
    rmSync: (path, options) => {
        return window.HeliosAPI?.ipc?.sendSync('fs:rmSync', path, options)
    },
    unlinkSync: (path) => {
        return window.HeliosAPI?.ipc?.sendSync('fs:unlinkSync', path)
    },
    renameSync: (path, newPath) => {
        return window.HeliosAPI?.ipc?.sendSync('fs:renameSync', path, newPath)
    },
    createWriteStream: (path, options) => {
        const { Writable } = require('stream')
        const buffer = []
        const w = new Writable({
            write(chunk, encoding, callback) {
                buffer.push(chunk)
                if (typeof callback === 'function') callback()
            },
            async final(callback) {
                const fullData = Buffer.concat(buffer)
                buffer.length = 0
                try {
                    await fs.promises.writeFile(path, fullData)
                    // Small grace period for OS flush
                    await new Promise(r => setTimeout(r, 20))
                    if (typeof callback === 'function') callback()
                } catch (err) {
                    if (typeof callback === 'function') callback(err)
                }
            }
        })
        return w
    },
    createReadStream: (path, options) => {
        const { Readable } = require('stream')
        const r = new Readable({
            async read() {
                try {
                    const data = await fs.promises.readFile(path)
                    this.push(data)
                    this.push(null)
                } catch (e) {
                    this.destroy(e)
                }
            }
        })
        return r
    }
}

// Support for 'const fs = require('fs/promises')' pattern
// We add all promises methods to the top level of the exported object
// while keeping the .promises property for 'const fs = require('fs').promises'
const exported = { ...fs, ...fs.promises }

module.exports = exported
