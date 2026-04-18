/**
 * OS Polyfill for the renderer using Main process bridge.
 */
const { ipcRenderer } = require('electron')

let cache = null
function getInfo() {
    if (cache) return cache
    try {
        if (!window.HeliosAPI?.ipc) {
            return {
                totalmem: 8 * 1024 * 1024 * 1024,
                freemem: 4 * 1024 * 1024 * 1024,
                cpus: [{ model: 'Unknown', speed: 0, times: {} }],
                platform: 'win32',
                arch: 'x64',
                networkInterfaces: {}
            }
        }
        cache = window.HeliosAPI.ipc.sendSync('system:getSystemInfoSync')
        return cache
    } catch (e) {
        console.warn('[os-polyfill] Failed to get system info, using fallbacks:', e.message || e)
        return {
            totalmem: 8 * 1024 * 1024 * 1024,
            freemem: 4 * 1024 * 1024 * 1024,
            cpus: [{ model: 'Unknown', speed: 0, times: {} }],
            platform: 'win32',
            arch: 'x64',
            networkInterfaces: {}
        }
    }
}

const os = {
    totalmem: () => getInfo().totalmem,
    freemem: () => getInfo().freemem,
    cpus: () => getInfo().cpus,
    platform: () => getInfo().platform || 'win32',
    arch: () => getInfo().arch || 'x64',
    release: () => '10.0.0',
    type: () => 'Windows_NT',
    hostname: () => 'HeliosClient',
    uptime: () => 3600,
    loadavg: () => [0, 0, 0],
    userInfo: () => ({ username: 'HeliosUser', homedir: '/', shell: null }),
    homedir: () => '/',
    tmpdir: () => '/tmp',
    networkInterfaces: () => getInfo().networkInterfaces || {},
    EOL: '\n'
}

module.exports = os
