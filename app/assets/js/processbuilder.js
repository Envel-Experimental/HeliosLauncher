const crypto                = require('crypto')
const fs                    = require('fs-extra')
const { mcVersionAtLeast }  = require('helios-core/common') // Trimmed imports
const { Type }              = require('helios-distribution-types')
const os                    = require('os')
const path                  = require('path') // Keep path for tempNativePath generation for now

// Load modules
const ProcessConfiguration  = require('./processbuilder/modules/config')
const logger                = require('./processbuilder/modules/logging')
const { executeMinecraftProcess } = require('./processbuilder/modules/execution')
const ConfigManager         = require('./configmanager')

// Helper function loaders
const { setupLiteLoader }   = require('./processbuilder/liteloader')
const { resolveModConfiguration, constructJSONModList, constructModList } = require('./processbuilder/modConfig')
const { constructJVMArguments } = require('./processbuilder/jvmArgs')


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
        this.config = new ProcessConfiguration(distroServer, vanillaManifest, modManifest, authUser, launcherVersion)
        // Properties like gameDir, commonDir, server, vanillaManifest, authUser, launcherVersion,
        // forgeModListFile, fmlDir, llDir, libPath are now accessed via this.config.get...()
        // State properties like usingLiteLoader, usingFabricLoader, llPath are also in this.config
    }

    /**
     * Convienence method to run the functions typically used to build a process.
     */
    build(){
        // Use config properties
        fs.ensureDirSync(this.config.getGameDirectory())
        // TODO: tempNativePath generation could also be part of ProcessConfiguration or a dedicated utility
        const tempNativePath = path.join(os.tmpdir(), ConfigManager.getTempNativeFolder(), crypto.pseudoRandomBytes(16).toString('hex'))
        process.throwDeprecation = true // This is a global process flag, consider if it's still needed here.

        // Pass config to helper functions
        setupLiteLoader(this.config) // setupLiteLoader will need to use config.setUsingLiteLoader, etc.
        logger.info('Using liteloader:', this.config.isUsingLiteLoader())

        // Determine and set Fabric loader status on the config object
        const isFabric = this.config.getServer().modules.some(mdl => mdl.rawModule.type === Type.Fabric)
        this.config.setUsingFabricLoader(isFabric)
        logger.info('Using fabric loader:', this.config.isUsingFabricLoader())

        // resolveModConfiguration will need to be adapted to take config object
        const modObj = resolveModConfiguration(this.config, ConfigManager.getModConfiguration(this.config.getServer().rawServer.id).mods, this.config.getServer().modules)

        // mcVersionAtLeast and constructJSONModList will need to take config or specific values from it
        if(!mcVersionAtLeast(this.config.getVanillaManifest().id, '1.13')){ // Example: or pass server.rawServer.minecraftVersion
            constructJSONModList(this.config, 'forge', modObj.fMods, true)
            if(this.config.isUsingLiteLoader()){
                constructJSONModList(this.config, 'liteloader', modObj.lMods, true)
            }
        }

        const uberModArr = modObj.fMods.concat(modObj.lMods)
        // constructJVMArguments will need to be adapted
        let args = constructJVMArguments(this.config, uberModArr, tempNativePath)

        if(mcVersionAtLeast(this.config.getVanillaManifest().id, '1.13')){
            // constructModList will need to be adapted
            args = args.concat(constructModList(this.config, modObj.fMods))
        }

        logger.info('Launch Arguments:', args)

        // Delegate to execution module
        const javaExecutable = ConfigManager.getJavaExecutable(this.config.getServer().rawServer.id)
        return executeMinecraftProcess(javaExecutable, args, this.config.getGameDirectory(), tempNativePath)
    }

}

module.exports = ProcessBuilder
