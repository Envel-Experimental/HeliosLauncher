// Liteloader specific setup logic

const fs = require('fs-extra');
const { Type } = require('helios-distribution-types');
const ConfigManager = require('../configmanager');
const { isModEnabled } = require('./utils');

/**
 * Function which performs a preliminary scan of the top level
 * mods. If liteloader is present here, we setup the special liteloader
 * launch options. Note that liteloader is only allowed as a top level
 * mod. It must not be declared as a submodule.
 *
 * @param {Object} processBuilderInstance The instance of ProcessBuilder.
 */
function setupLiteLoader(processBuilderInstance) {
    for(let ll of processBuilderInstance.server.modules){
        if(ll.rawModule.type === Type.LiteLoader){
            if(!ll.getRequired().value){
                const modCfg = ConfigManager.getModConfiguration(processBuilderInstance.server.rawServer.id).mods
                if(isModEnabled(modCfg[ll.getVersionlessMavenIdentifier()], ll.getRequired())){
                    if(fs.existsSync(ll.getPath())){
                        processBuilderInstance.usingLiteLoader = true
                        processBuilderInstance.llPath = ll.getPath()
                    }
                }
            } else {
                if(fs.existsSync(ll.getPath())){
                    processBuilderInstance.usingLiteLoader = true
                    processBuilderInstance.llPath = ll.getPath()
                }
            }
        }
    }
}

module.exports = {
    setupLiteLoader
};
