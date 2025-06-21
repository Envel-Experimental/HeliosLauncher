// Mod configuration specific logic

const fs = require('fs-extra')
const path = require('path')
const { Type } = require('helios-distribution-types')
// const ConfigManager = require('../configmanager') // Unused after refactor (modCfg passed into resolveModConfiguration)
const { isModEnabled } = require('./utils')
const logger = require('./modules/logging') // Assuming centralized logger

// Helper function (will not be exported)
function _lteMinorVersion(config, version) {
    // Assuming modManifest.id is like "1.12.2-forge-..." or "1.12.2"
    const mcVersionFromFile = config.getModManifest().id.split('-')[0]
    return Number(mcVersionFromFile.split('.')[1]) <= Number(version)
}

// Helper function (will not be exported)
function _requiresAbsolute(config){
    try {
        // Minecraft 1.9 or earlier (e.g., 1.7.10, 1.8.9, 1.9.4) generally used relative paths for FML.
        if(_lteMinorVersion(config, 9)) {
            return false
        }

        // Logic for Forge versions (e.g., 1.12.2 uses specific Forge versions for this rule)
        const modManifestId = config.getModManifest().id

        // Check for 1.12.2 Forge versions
        if (modManifestId.startsWith('1.12.2-forge-')) {
            const forgeVersionPart = modManifestId.substring('1.12.2-forge-'.length)
            const pts = forgeVersionPart.split('.') // Example: "14.23.5.2860"
            // Forge 14.23.3.2655 was the turning point for requiring absolute paths for --fml.mavenRoots for 1.12.2
            const min = [14, 23, 3, 2655]
            for(let i=0; i<pts.length; i++){
                const parsed = parseInt(pts[i], 10)
                if (isNaN(parsed)) {
                    logger.warn(`Could not parse Forge version part: ${pts[i]} from ${modManifestId} for _requiresAbsolute check. Defaulting to true.`)
                    return true // Safety for unexpected format
                }
                if(parsed < min[i]){
                    return false
                } else if(parsed > min[i]){
                    return true
                }
            }
            return true // Exact match to min version or newer parts not specified
        }
        // For other MC versions (1.10, 1.11, 1.13+), assume absolute paths are required or safer.
        // The original code defaulted to true if not caught by the specific 1.12.2 check or _lteMinorVersion(9)
    } catch (err) {
        logger.warn(`Error parsing modManifest.id ('${config.getModManifest().id}') for _requiresAbsolute logic, defaulting to true (absolute paths):`, err)
    }
    // Default for versions 1.10+ (that are not 1.12.2 with an older Forge) or if parsing failed: use absolute paths.
    return true
}

/**
 * Resolve an array of all enabled mods. These mods will be constructed into
 * a mod list format and enabled at launch.
 *
 * @param {ProcessConfiguration} config The ProcessConfiguration instance.
 * @param {Object} modCfg The mod configuration object from ConfigManager.
 * @param {Array.<Object>} mdls An array of server modules to parse.
 * @returns {{fMods: Array.<Object>, lMods: Array.<Object>}} An object which contains
 * a list of enabled forge mods and litemods.
 */
function resolveModConfiguration(config, modCfg, mdls){
    let fMods = []
    let lMods = []

    for(let mdl of mdls){
        const type = mdl.rawModule.type
        if(type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod){
            const isActuallyRequired = mdl.getRequired().value // Is the module itself marked as required:true
            const currentModConfig = modCfg[mdl.getVersionlessMavenIdentifier()]

            // isModEnabled expects the specific mod's config entry and the module's required object.
            const e = isModEnabled(currentModConfig, mdl.getRequired())

            if(isActuallyRequired || e) { // If the module is hard-required, or if it's optional and enabled
                if(mdl.subModules && mdl.subModules.length > 0){
                    // Pass the sub-mod config if it exists: currentModConfig.mods
                    const subModCfg = currentModConfig && currentModConfig.mods ? currentModConfig.mods : {}
                    const v = resolveModConfiguration(config, subModCfg, mdl.subModules)
                    fMods = fMods.concat(v.fMods)
                    lMods = lMods.concat(v.lMods)
                    // LiteLoader module itself is a loader, not added to fMods/lMods for game launch args here.
                    if(type === Type.LiteLoader){
                        continue
                    }
                }
                // Add the module itself if it's a mod type (and not just a type container like LiteLoader)
                if(type === Type.ForgeMod || type === Type.FabricMod){
                    fMods.push(mdl)
                } else if (type === Type.LiteMod) { // Explicitly LiteMod
                    lMods.push(mdl)
                }
            }
        }
    }
    return { fMods, lMods }
}

/**
 * Construct a mod list json object.
 * This is typically for Forge versions prior to 1.13.
 *
 * @param {ProcessConfiguration} config The ProcessConfiguration instance.
 * @param {'forge' | 'liteloader'} type The mod list type to construct.
 * @param {Array.<Object>} mods An array of mods to add to the mod list.
 * @param {boolean} save Optional. Whether or not we should save the mod list file.
 */
function constructJSONModList(config, type, mods, save = false){
    const modList = {
        repositoryRoot: ((type === 'forge' && _requiresAbsolute(config)) ? 'absolute:' : '') + path.join(config.getCommonDirectory(), 'modstore')
    }

    const ids = []
    if(type === 'forge'){
        for(let mod of mods){
            ids.push(mod.getExtensionlessMavenIdentifier())
        }
    } else { // liteloader
        for(let mod of mods){
            ids.push(mod.getMavenIdentifier())
        }
    }
    modList.modRef = ids

    if(save){
        const json = JSON.stringify(modList, null, 4)
        const filePath = type === 'forge' ? config.getFmlDirectory() : config.getLiteLoaderDirectory()
        fs.writeFileSync(filePath, json, 'UTF-8')
    }
    return modList
}

/**
 * Construct the mod argument list for Forge 1.13+ and Fabric.
 * This involves creating a file listing the mods.
 *
 * @param {ProcessConfiguration} config The ProcessConfiguration instance.
 * @param {Array.<Object>} mods An array of mods to add to the mod list.
 */
function constructModList(config, mods) {
    if (!mods || mods.length === 0) {
        return []
    }

    const writeBuffer = mods.map(mod => {
        return config.isUsingFabricLoader() ? mod.getPath() : mod.getExtensionlessMavenIdentifier()
    }).join('\n')

    // Only write file and return args if there's content
    if(writeBuffer.trim()) {
        // forgeModListFile is an absolute path calculated in ProcessConfiguration
        fs.writeFileSync(config.getForgeModListFile(), writeBuffer, 'UTF-8')

        if (config.isUsingFabricLoader()) {
            return [
                '--fabric.addMods',
                `@${config.getForgeModListFile()}` // Path to the file list
            ]
        } else { // Forge 1.13+
            // The path to modstore should be relative to the game directory (cwd for the process)
            const gameDir = config.getGameDirectory()
            const modstoreDir = path.join(config.getCommonDirectory(), 'modstore')
            // Calculate relative path from gameDir to modstoreDir and ensure forward slashes for Java CLI
            const relativeModstorePath = path.relative(gameDir, modstoreDir).replace(/\\/g, '/')

            return [
                '--fml.mavenRoots',
                relativeModstorePath,
                '--fml.modLists',
                // getForgeModListFile() is an absolute path (e.g., /path/to/gameDir/forgeMods.list).
                // FML for 1.13+ expects a path relative to the game directory for this argument.
                path.basename(config.getForgeModListFile())
            ]
        }
    } else {
        return []
    }
}

module.exports = {
    resolveModConfiguration,
    constructJSONModList,
    constructModList
}
