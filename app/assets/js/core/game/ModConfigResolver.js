const fs = require('fs-extra')
const path = require('path')
const { Type } = require('../common/DistributionClasses')
const ConfigManager = require('../../configmanager')

/**
 * Module for handling mod configurations and resolutions.
 * 
 * Responsibilities:
 * 1. Determining if mods are enabled/disabled based on configuration.
 * 2. Resolving recursive mod dependencies (sub-modules).
 * 3. Generating mod list files (forgeModList.json, liteloaderModList.json).
 */
class ModConfigResolver {

    /**
     * @param {Object} server The server distribution object.
     * @param {Object} modManifest The manifest data for the mod loader.
     * @param {string} commonDir The path to the common directory.
     */
    constructor(server, modManifest, commonDir) {
        this.server = server
        this.modManifest = modManifest
        this.commonDir = commonDir
    }

    /**
     * Determine if an optional mod is enabled from its configuration value.
     * 
     * @param {Object | boolean} modCfg The user's configuration for this mod.
     * @param {Object} required The 'required' object from the mod's distro declaration.
     * @returns {boolean} True if the mod is enabled, false otherwise.
     */
    static isModEnabled(modCfg, required = null) {
        return modCfg != null ? ((typeof modCfg === 'boolean' && modCfg) || (typeof modCfg === 'object' && (typeof modCfg.value !== 'undefined' ? modCfg.value : true))) : required != null ? required.def : true
    }

    /**
     * Recursively resolve an array of all enabled mods.
     * 
     * @param {Object} modCfg The mod configuration object from ConfigManager.
     * @param {Array.<Object>} mdls An array of modules to scan.
     * @returns {{fMods: Array.<Object>, lMods: Array.<Object>}} Objects containing lists of enabled Forge and LiteLoader mods.
     */
    resolveModConfiguration(modCfg, mdls) {
        let fMods = []
        let lMods = []

        for (let mdl of mdls) {
            const type = mdl.rawModule.type
            if (type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod) {
                const o = !mdl.getRequired().value

                // Safety check for configuration existence to prevent crash if config is missing.
                const modConfigEntry = modCfg[mdl.getVersionlessMavenIdentifier()];
                const e = ModConfigResolver.isModEnabled(modConfigEntry, mdl.getRequired())

                if (!o || (o && e)) {
                    if (mdl.subModules.length > 0) {
                        // Safe recursion
                        const nextModCfg = (modConfigEntry && modConfigEntry.mods) ? modConfigEntry.mods : {};
                        const v = this.resolveModConfiguration(nextModCfg, mdl.subModules)
                        fMods = fMods.concat(v.fMods)
                        lMods = lMods.concat(v.lMods)
                        if (type === Type.LiteLoader) {
                            continue
                        }
                    }
                    if (type === Type.ForgeMod || type === Type.FabricMod) {
                        fMods.push(mdl)
                    } else {
                        lMods.push(mdl)
                    }
                }
            }
        }

        return {
            fMods,
            lMods
        }
    }

    /**
     * Check if the current mod loader version is less than or equal to a specific minor version.
     * Used for handling legacy Forge formatting differences.
     * 
     * @param {number} version The minor version to check against.
     * @returns {boolean} True if the version is <= the provided version.
     */
    _lteMinorVersion(version) {
        return Number(this.modManifest.id.split('-')[0].split('.')[1]) <= Number(version)
    }

    /**
     * Check if the specific Forge version requires the 'absolute:' prefix for paths.
     * 
     * @returns {boolean} True if absolute prefix is required.
     */
    _requiresAbsolute() {
        try {
            if (this._lteMinorVersion(9)) {
                return false
            }
            const ver = this.modManifest.id.split('-')[2]
            const pts = ver.split('.')
            const min = [14, 23, 3, 2655]
            for (let i = 0; i < pts.length; i++) {
                const parsed = Number.parseInt(pts[i])
                if (parsed < min[i]) {
                    return false
                } else if (parsed > min[i]) {
                    return true
                }
            }
        } catch (err) {
            // We know old forge versions follow this format.
        }
        return true
    }

    /**
     * Construct a mod list JSON object for legacy Forge/LiteLoader.
     * 
     * @param {'forge' | 'liteloader'} type The type of list to construct.
     * @param {Array.<Object>} mods The list of enabled mods.
     * @param {string} fmlDir The path to save forgeModList.json.
     * @param {string} llDir The path to save liteloaderModList.json.
     * @param {boolean} save Whether to write the file to disk.
     * @returns {Object} The constructed mod list object.
     */
    constructJSONModList(type, mods, fmlDir, llDir, save = false) {
        const modList = {
            repositoryRoot: ((type === 'forge' && this._requiresAbsolute()) ? 'absolute:' : '') + path.join(this.commonDir, 'modstore')
        }

        const ids = []
        if (type === 'forge') {
            for (let mod of mods) {
                ids.push(mod.getExtensionlessMavenIdentifier())
            }
        } else {
            for (let mod of mods) {
                ids.push(mod.getMavenIdentifier())
            }
        }
        modList.modRef = ids

        if (save) {
            const json = JSON.stringify(modList, null, 4)
            fs.writeFileSync(type === 'forge' ? fmlDir : llDir, json, 'UTF-8')
        }

        return modList
    }

    /**
     * Construct the mod argument list for Forge 1.13+ and Fabric.
     * 
     * @param {Array.<Object>} mods The list of enabled mods.
     * @param {string} forgeModListFile The path to the mod list file.
     * @param {boolean} usingFabricLoader Whether Fabric is being used.
     * @returns {Array.<string>} The arguments to add to the JVM launch command.
     */
    constructModList(mods, forgeModListFile, usingFabricLoader) {
        const writeBuffer = mods.map(mod => {
            return usingFabricLoader ? mod.getPath() : mod.getExtensionlessMavenIdentifier()
        }).join('\n')

        if (writeBuffer) {
            fs.writeFileSync(forgeModListFile, writeBuffer, 'UTF-8')
            return usingFabricLoader ? [
                '--fabric.addMods',
                `@${forgeModListFile}`
            ] : [
                '--fml.mavenRoots',
                path.join('..', '..', 'common', 'modstore'),
                '--fml.modLists',
                forgeModListFile
            ]
        } else {
            return []
        }
    }

    /**
     * Resolve the libraries declared by this server in order to add them to the classpath.
     * This method recursively checks modules and submodules for required libraries.
     * 
     * @param {Array.<Object>} mods An array of enabled mods.
     * @returns {{[id: string]: string}} Map of library identifiers to their absolute paths.
     */
    resolveServerLibraries(mods) {
        const mdls = this.server.modules
        let libs = {}

        // Locate Forge/Fabric/Libraries
        for (let mdl of mdls) {
            const type = mdl.rawModule.type
            if (type === Type.ForgeHosted || type === Type.Fabric || type === Type.Library) {
                libs[mdl.getVersionlessMavenIdentifier()] = mdl.getPath()
                if (mdl.subModules.length > 0) {
                    const res = this._resolveModuleLibraries(mdl)
                    libs = { ...libs, ...res }
                }
            }
        }

        // Check for any libraries in our mod list.
        for (let i = 0; i < mods.length; i++) {
            if (mods.sub_modules != null) {
                const res = this._resolveModuleLibraries(mods[i])
                libs = { ...libs, ...res }
            }
        }

        return libs
    }

    /**
     * Helper to recursively resolve libraries from a module and its submodules.
     * 
     * @param {Object} mdl The module to scan.
     * @returns {Object} Map of resolved libraries.
     */
    _resolveModuleLibraries(mdl) {
        if (!mdl.subModules.length > 0) {
            return {}
        }
        let libs = {}
        for (let sm of mdl.subModules) {
            if (sm.rawModule.type === Type.Library) {

                if (sm.rawModule.classpath ?? true) {
                    libs[sm.getVersionlessMavenIdentifier()] = sm.getPath()
                }
            }
            if (mdl.subModules.length > 0) {
                const res = this._resolveModuleLibraries(sm)
                libs = { ...libs, ...res }
            }
        }
        return libs
    }

}

module.exports = ModConfigResolver
