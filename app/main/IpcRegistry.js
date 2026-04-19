const { ipcMain, app, shell } = require('electron')
const WindowManager = require('./WindowManager')
const AutoUpdaterService = require('./AutoUpdaterService')
const MicrosoftAuthService = require('./MicrosoftAuthService')
const LauncherService = require('./LauncherService')
const FsService = require('./FsService')
const ServerStatusService = require('./ServerStatusService')
const ConfigManager = require('../assets/js/core/configmanager')
const { SHELL_OPCODE } = require('../assets/js/core/ipcconstants')

class IpcRegistry {
    init() {
        // Initialize sub-services
        AutoUpdaterService.init()
        MicrosoftAuthService.init()
        LauncherService.init()
        FsService.init()
        ServerStatusService.init()
        require('../assets/js/core/LaunchController').init()
        
        ipcMain.on('app:getVersionSync', (event) => {
            event.returnValue = app.getVersion()
        })

        ipcMain.on('crypto:hashSync', (event, algorithm, data) => {
            try {
                const crypto = require('crypto')
                event.returnValue = crypto.createHash(algorithm).update(data).digest('hex')
            } catch (e) {
                console.error(`[IpcRegistry] Hash failed for ${algorithm}:`, e)
                event.returnValue = null
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

        ipcMain.on('fs:statSync', (event, path) => {
            try {
                const fsSync = require('fs')
                const stats = fsSync.statSync(path)
                event.returnValue = {
                    isDirectory: stats.isDirectory(),
                    isFile: stats.isFile(),
                    size: stats.size,
                    mtimeMs: stats.mtimeMs
                }
            } catch (e) {
                event.returnValue = null
            }
        })

        // Window Action Handlers
        ipcMain.on('window-action', (event, action, ...args) => {
            const win = WindowManager.getMainWindow()
            if (!win) return

            switch (action) {
                case 'close': win.close(); break
                case 'minimize': win.minimize(); break
                case 'maximize':
                    if (win.isMaximized()) win.unmaximize()
                    else win.maximize()
                    break
                case 'unmaximize':
                    win.unmaximize()
                    break
                case 'isMaximized':
                    event.returnValue = win.isMaximized()
                    break
                case 'setProgressBar':
                    win.setProgressBar(args[0])
                    break
                case 'toggleDevTools':
                    win.webContents.toggleDevTools()
                    break
            }
        })

        ipcMain.on('renderer-error', (event, error) => {
            console.error('[Renderer ERROR]', error)
        })

        ipcMain.on('renderer-log', (event, msg) => {
            console.log('[Renderer Log]', msg)
        })

        ipcMain.on('renderer-warn', (event, msg) => {
            console.warn('[Renderer Warning]', msg)
        })

        // Config IPCs
        ipcMain.handle('config:load', async () => {
            if (!ConfigManager.isLoaded()) await ConfigManager.load()
            return ConfigManager.getConfig()
        })

        ipcMain.handle('config:save', async (event, data) => {
            ConfigManager.setConfig(data)
            return await ConfigManager.save()
        })

        ipcMain.handle('config:getLauncherDirectory', async () => {
            return await ConfigManager.getLauncherDirectory()
        })

        ipcMain.handle('launcher:showOpenDialog', async (event, options) => {
            const { dialog } = require('electron')
            const win = WindowManager.getMainWindow()
            return await dialog.showOpenDialog(win, options)
        })

        // General App IPCs
        ipcMain.handle('config:get', () => {
            return ConfigManager.getConfig()
        })

        ipcMain.on('renderer-ready', (event) => {
            console.log('[Main] Renderer is ready, sending distribution index signal.')
            event.sender.send('distributionIndexDone', true)
        })

        ipcMain.on('distributionIndexDone', (event, res) => {
            if (!event.sender.isDestroyed()) {
                event.sender.send('distributionIndexDone', res)
            }
        })

        ipcMain.handle(SHELL_OPCODE.TRASH_ITEM, async (event, ...args) => {
            try {
                await shell.trashItem(args[0])
                return { result: true }
            } catch (error) {
                return { result: false, error: error }
            }
        })

        ipcMain.on('app:restart', () => {
            console.log('[Main] Restart requested...')
            const args = process.argv.slice(1).filter(arg =>
                !arg.startsWith('--inspect') &&
                !arg.startsWith('--remote-debugging-port') &&
                !arg.startsWith('--enable-logging') &&
                !arg.startsWith('--debug-brk')
            )
            app.relaunch({ execPath: process.execPath, args: args })
            app.exit(0)
        })

        ipcMain.on('app:open-url', (event, url) => {
            if (url && (url.startsWith('http') || url.startsWith('https'))) {
                shell.openExternal(url).catch(err => console.error('Failed to open external URL:', err))
            }
        })

        // Mirror & P2P IPCs (can be moved later if needed)
        const MirrorManager = require('../../network/MirrorManager')
        const P2PEngine = require('../../network/P2PEngine')
        const { BOOTSTRAP_NODES } = require('../../network/config')
        const { execFile } = require('child_process')

        ipcMain.handle('mirrors:getStatus', () => MirrorManager.getMirrorStatus())
        ipcMain.handle('p2p:getInfo', () => P2PEngine.getNetworkInfo())

        ipcMain.handle('p2p:getBootstrapStatus', async () => {
            const results = []
            for (let i = 0; i < BOOTSTRAP_NODES.length; i++) {
                results.push(await this.checkNodeStatus(BOOTSTRAP_NODES[i], i))
            }
            return results
        })

        ipcMain.handle('distribution:verify', async (event, data) => {
            const { verifyDistribution } = require('../assets/js/core/util/SignatureUtils')
            return verifyDistribution(data)
        })

        ipcMain.handle('p2p:configUpdate', async () => {
            try {
                const ConfigManager = require('../assets/js/core/configmanager')
                await ConfigManager.load()
                await P2PEngine.start()
            } catch (err) {
                console.error('Failed to update P2P Config:', err)
            }
        })

        // System Info Bridge
        ipcMain.handle('system:getSystemInfo', () => {
            const os = require('os')
            return {
                totalmem: os.totalmem(),
                freemem: os.freemem(),
                cpus: os.cpus(),
                platform: process.platform,
                arch: process.arch
            }
        })

        ipcMain.on('system:getSystemInfoSync', (event) => {
            const os = require('os')
            event.returnValue = {
                totalmem: os.totalmem(),
                freemem: os.freemem(),
                cpus: os.cpus(),
                platform: process.platform,
                arch: process.arch,
                networkInterfaces: os.networkInterfaces()
            }
        });

        ipcMain.on('system:cwdSync', (event) => {
            event.returnValue = process.cwd()
        })


        ipcMain.handle('shell:openPath', async (event, path) => {
            return await shell.openPath(path)
        })

        ipcMain.handle('shell:trashItem', async (event, path) => {
            try {
                await shell.trashItem(path)
                return { result: true }
            } catch (e) {
                return { result: false, error: e.message }
            }
        })
    }

    async checkNodeStatus(node, index) {
        return new Promise((resolve) => {
            const { execFile } = require('child_process')
            const platform = process.platform

            if (!node || !this.isValidHost(node.host)) {
                return resolve({ index, isPrivate: !!(node && node.publicKey), status: 'timeout', latency: -1 })
            }

            const pingCmd = 'ping'
            const pingArgs = platform === 'win32'
                ? ['-n', '1', '-w', '2000', node.host]
                : ['-c', '1', '-W', '2', node.host]

            execFile(pingCmd, pingArgs, (error, stdout) => {
                const output = stdout ? stdout.toString() : ''
                const isOnline = !error && (output.includes('time=') || output.includes('время=') || output.includes('TTL='))
                resolve({
                    index,
                    isPrivate: !!node.publicKey,
                    status: isOnline ? 'online' : 'timeout',
                    latency: isOnline ? this.parsePingLatency(output, platform) || '< 100' : -1
                })
            })
        })
    }

    isValidHost(host) {
        if (typeof host !== 'string' || !host) return false
        return /^[0-9A-Za-z\.\-\:\[\]%]+$/.test(host)
    }

    parsePingLatency(output, platform) {
        try {
            const match = output.match(/time[=<]([\d\.]+)/i)
            return match ? Math.round(parseFloat(match[1])) : null
        } catch (e) {
            return null
        }
    }
}

module.exports = new IpcRegistry()
