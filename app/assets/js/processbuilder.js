const child_process         = require('child_process')
const crypto                = require('crypto')
const fs                    = require('fs-extra')
const { LoggerUtil }        = require('helios-core')
const { mcVersionAtLeast }  = require('helios-core/common') // Trimmed imports
const { Type }              = require('helios-distribution-types')
const os                    = require('os')
const path                  = require('path')
const { sendToSentry }      = require('./preloader');
// Removed: const { getClasspathSeparator, isModEnabled } = require('./processbuilder/utils');
const { setupLiteLoader }   = require('./processbuilder/liteloader');
const { resolveModConfiguration, constructJSONModList, constructModList } = require('./processbuilder/modConfig');
const { constructJVMArguments } = require('./processbuilder/jvmArgs');
// Removed: const AdmZip = require('adm-zip');

const ConfigManager            = require('./configmanager')

const logger = LoggerUtil.getLogger('ProcessBuilder')


/**
 * Only forge and fabric are top level mod loaders.
 *
 * Forge 1.13+ launch logic is similar to fabrics, for now using usingFabricLoader flag to
 * change minor details when needed.
 *
 * Rewrite of this module may be needed in the future.
 */
class ProcessBuilder {

    constructor(distroServer, vanillaManifest, modManifest, authUser, launcherVersion){
        this.gameDir = path.join(ConfigManager.getInstanceDirectory(), distroServer.rawServer.id)
        this.commonDir = ConfigManager.getCommonDirectory()
        this.server = distroServer
        this.vanillaManifest = vanillaManifest
        this.modManifest = modManifest
        this.authUser = authUser
        this.launcherVersion = launcherVersion
        this.forgeModListFile = path.join(this.gameDir, 'forgeMods.list') // 1.13+
        this.fmlDir = path.join(this.gameDir, 'forgeModList.json')
        this.llDir = path.join(this.gameDir, 'liteloaderModList.json')
        this.libPath = path.join(this.commonDir, 'libraries')

        this.usingLiteLoader = false
        this.usingFabricLoader = false
        this.llPath = null
    }

    /**
     * Convienence method to run the functions typically used to build a process.
     */
    build(){
        fs.ensureDirSync(this.gameDir)
        const tempNativePath = path.join(os.tmpdir(), ConfigManager.getTempNativeFolder(), crypto.pseudoRandomBytes(16).toString('hex'))
        process.throwDeprecation = true
        setupLiteLoader(this)
        logger.info('Using liteloader:', this.usingLiteLoader)
        this.usingFabricLoader = this.server.modules.some(mdl => mdl.rawModule.type === Type.Fabric)
        logger.info('Using fabric loader:', this.usingFabricLoader)
        const modObj = resolveModConfiguration(this, ConfigManager.getModConfiguration(this.server.rawServer.id).mods, this.server.modules)

        if(!mcVersionAtLeast('1.13', this.server.rawServer.minecraftVersion)){
            constructJSONModList(this, 'forge', modObj.fMods, true)
            if(this.usingLiteLoader){
                constructJSONModList(this, 'liteloader', modObj.lMods, true)
            }
        }

        const uberModArr = modObj.fMods.concat(modObj.lMods)
        let args = constructJVMArguments(this, uberModArr, tempNativePath)

        if(mcVersionAtLeast('1.13', this.server.rawServer.minecraftVersion)){
            args = args.concat(constructModList(this, modObj.fMods))
        }

        logger.info('Launch Arguments:', args)

        const child = child_process.spawn(ConfigManager.getJavaExecutable(this.server.rawServer.id), args, {
            cwd: this.gameDir,
            detached: ConfigManager.getLaunchDetached()
        })

        if(ConfigManager.getLaunchDetached()){
            child.unref()
        }

        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')

        child.stdout.on('data', (data) => {
            data.trim().split('\n').forEach(x => console.log(`\x1b[32m[Minecraft]\x1b[0m ${x}`))

        })
        child.stderr.on('data', (data) => {
            data.trim().split('\n').forEach(x => console.log(`\x1b[31m[Minecraft]\x1b[0m ${x}`))
        })
        child.on('close', (code, signal) => {
            logger.info('Exited with code', code)
            if(code != 0){


                const exitMessage = `Process exited with code: ${code}`;
                sendToSentry(exitMessage, 'error');

                setOverlayContent(
                    Lang.queryJS('processbuilder.exit.exitErrorHeader'),
                    Lang.queryJS('processbuilder.exit.message') + code,
                    Lang.queryJS('uibinder.startup.closeButton')
                )
                setOverlayHandler(() => {
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false)
                })
                toggleOverlay(true, true)
            }
            fs.remove(tempNativePath, (err) => {
                if(err){
                    logger.warn('Error while deleting temp dir', err)
                } else {
                    logger.info('Temp dir deleted successfully.')
                }
            })
        })

        return child
    }

}

module.exports = ProcessBuilder
