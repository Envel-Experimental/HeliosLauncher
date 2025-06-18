// Mod configuration specific logic

const fs = require('fs-extra');
const path = require('path');
const { Type } = require('helios-distribution-types');
const ConfigManager = require('../configmanager'); // Adjust path as necessary
const { isModEnabled } = require('./utils'); // Assuming utils.js is in the same directory

// Helper function (will not be exported)
function _lteMinorVersion(processBuilderInstance, version) {
    // Content to be added
    return Number(processBuilderInstance.modManifest.id.split('-')[0].split('.')[1]) <= Number(version);
}

// Helper function (will not be exported)
function _requiresAbsolute(processBuilderInstance){
    // Content to be added
    try {
        if(_lteMinorVersion(processBuilderInstance, 9)) {
            return false;
        }
        const ver = processBuilderInstance.modManifest.id.split('-')[2];
        const pts = ver.split('.');
        const min = [14, 23, 3, 2655];
        for(let i=0; i<pts.length; i++){
            const parsed = Number.parseInt(pts[i]);
            if(parsed < min[i]){
                return false;
            } else if(parsed > min[i]){
                return true;
            }
        }
    } catch (err) {
        // We know old forge versions follow this format.
        // Error must be caused by newer version.
    }
    // Equal or errored
    return true;
}

/**
 * Resolve an array of all enabled mods. These mods will be constructed into
 * a mod list format and enabled at launch.
 *
 * @param {Object} processBuilderInstance The instance of ProcessBuilder.
 * @param {Object} modCfg The mod configuration object.
 * @param {Array.<Object>} mdls An array of modules to parse.
 * @returns {{fMods: Array.<Object>, lMods: Array.<Object>}} An object which contains
 * a list of enabled forge mods and litemods.
 */
function resolveModConfiguration(processBuilderInstance, modCfg, mdls){
    // Content to be added
    let fMods = [];
    let lMods = [];

    for(let mdl of mdls){
        const type = mdl.rawModule.type;
        if(type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod){
            const o = !mdl.getRequired().value;
            const e = isModEnabled(modCfg[mdl.getVersionlessMavenIdentifier()], mdl.getRequired());
            if(!o || (o && e)){
                if(mdl.subModules.length > 0){
                    const v = resolveModConfiguration(processBuilderInstance, modCfg[mdl.getVersionlessMavenIdentifier()].mods, mdl.subModules);
                    fMods = fMods.concat(v.fMods);
                    lMods = lMods.concat(v.lMods);
                    if(type === Type.LiteLoader){
                        continue;
                    }
                }
                if(type === Type.ForgeMod || type === Type.FabricMod){
                    fMods.push(mdl);
                } else {
                    lMods.push(mdl);
                }
            }
        }
    }

    return {
        fMods,
        lMods
    };
}

/**
 * Construct a mod list json object.
 *
 * @param {Object} processBuilderInstance The instance of ProcessBuilder.
 * @param {'forge' | 'liteloader'} type The mod list type to construct.
 * @param {Array.<Object>} mods An array of mods to add to the mod list.
 * @param {boolean} save Optional. Whether or not we should save the mod list file.
 */
function constructJSONModList(processBuilderInstance, type, mods, save = false){
    // Content to be added
    const modList = {
        repositoryRoot: ((type === 'forge' && _requiresAbsolute(processBuilderInstance)) ? 'absolute:' : '') + path.join(processBuilderInstance.commonDir, 'modstore')
    };

    const ids = [];
    if(type === 'forge'){
        for(let mod of mods){
            ids.push(mod.getExtensionlessMavenIdentifier());
        }
    } else {
        for(let mod of mods){
            ids.push(mod.getMavenIdentifier());
        }
    }
    modList.modRef = ids;

    if(save){
        const json = JSON.stringify(modList, null, 4);
        fs.writeFileSync(type === 'forge' ? processBuilderInstance.fmlDir : processBuilderInstance.llDir, json, 'UTF-8');
    }

    return modList;
}

/**
 * Construct the mod argument list for forge 1.13 and Fabric
 *
 * @param {Object} processBuilderInstance The instance of ProcessBuilder.
 * @param {Array.<Object>} mods An array of mods to add to the mod list.
 */
function constructModList(processBuilderInstance, mods) {
    // Content to be added
    const writeBuffer = mods.map(mod => {
        return processBuilderInstance.usingFabricLoader ? mod.getPath() : mod.getExtensionlessMavenIdentifier();
    }).join('\n');

    if(writeBuffer) {
        fs.writeFileSync(processBuilderInstance.forgeModListFile, writeBuffer, 'UTF-8');
        return processBuilderInstance.usingFabricLoader ? [
            '--fabric.addMods',
            `@${processBuilderInstance.forgeModListFile}`
        ] : [
            '--fml.mavenRoots',
            path.join('..', '..', 'common', 'modstore'), // This path might need adjustment if commonDir is not accessible directly
            '--fml.modLists',
            processBuilderInstance.forgeModListFile
        ];
    } else {
        return [];
    }
}

module.exports = {
    resolveModConfiguration,
    constructJSONModList,
    constructModList
};
