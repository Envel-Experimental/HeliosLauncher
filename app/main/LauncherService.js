const { ipcMain, app } = require('electron')
const path = require('path')
const ConfigManager = require('../assets/js/core/configmanager')
const ProcessBuilder = require('../assets/js/core/processbuilder')
const { MojangIndexProcessor } = require('../assets/js/core/dl/MojangIndexProcessor')
const { DistributionIndexProcessor } = require('../assets/js/core/dl/DistributionIndexProcessor')
const { LoggerUtil } = require('../assets/js/core/util/LoggerUtil')

const log = LoggerUtil.getLogger('LauncherService')

class LauncherService {
    constructor() {
        this.activeProcess = null
    }

    init() {
        ipcMain.handle('launcher:launch', async (event, { serverId, authUser }) => {
            return await this.launch(event, serverId, authUser)
        })
        ipcMain.on('launcher:terminate', () => {
            if (this.activeProcess) {
                this.activeProcess.kill()
                this.activeProcess = null
            }
        })
    }

    async launch(event, serverId, authUser) {
        log.info(`Preparing launch for server: ${serverId}`)
        
        const DistroManager = require('../assets/js/core/distromanager')
        const distro = await DistroManager.getDistribution()
        const serv = distro.getServerById(serverId)
        
        if (!serv) throw new Error('Server not found in distribution index.')

        const commonDir = await ConfigManager.getCommonDirectory()
        const mcVersion = serv.rawServer.minecraftVersion

        // 1. Initialize Processors
        const mojangProcessor = new MojangIndexProcessor(commonDir, mcVersion)
        const distroProcessor = new DistributionIndexProcessor(commonDir, distro, serverId)

        // 2. Load Manifests
        const modLoaderData = await distroProcessor.loadModLoaderVersionJson(serv)
        const versionData = await mojangProcessor.getVersionJson()

        // 3. Build Process
        const pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, app.getVersion())
        
        try {
            this.activeProcess = await pb.build()
            
            // Forward logs to renderer if needed
            this.activeProcess.stdout.on('data', (data) => {
                if (!event.sender.isDestroyed()) {
                    event.sender.send('launcher:log', data.toString())
                }
            })
            this.activeProcess.stderr.on('data', (data) => {
                if (!event.sender.isDestroyed()) {
                    event.sender.send('launcher:log-error', data.toString())
                }
            })

            this.activeProcess.on('exit', (code) => {
                log.info(`Game process exited with code ${code}`)
                if (!event.sender.isDestroyed()) {
                    event.sender.send('launcher:exit', code)
                }
                this.activeProcess = null
            })

            return { success: true }
        } catch (err) {
            log.error('Launch failed:', err)
            throw err
        }
    }
}

module.exports = new LauncherService()
