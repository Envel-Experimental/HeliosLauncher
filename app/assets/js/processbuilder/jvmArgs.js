// JVM argument construction logic
const os = require('os');
const path = require('path');
const ConfigManager = require('../configmanager'); // Adjust path as necessary
const { getMojangOS, mcVersionAtLeast } = require('@envel/helios-core/common');
const { getClasspathSeparator } = require('./utils');
const { classpathArg } = require('./classpath'); // Added import

// Internal helper function
function _lteMinorVersion(context, version) {
    return Number(context.modManifest.id.split('-')[0].split('.')[1]) <= Number(version);
}

// Internal helper function
function _processAutoConnectArg(context, args){
    if(ConfigManager.getAutoConnect() && context.server.rawServer.autoconnect){
        if(mcVersionAtLeast('1.20', context.server.rawServer.minecraftVersion)){
            args.push('--quickPlayMultiplayer');
            args.push(`${context.server.hostname}:${context.server.port}`);
        } else {
            args.push('--server');
            args.push(context.server.hostname);
            args.push('--port');
            args.push(context.server.port);
        }
    }
}

// Internal helper function
function _resolveForgeArgs(context){
    const mcArgs = context.modManifest.minecraftArguments.split(' ');
    const argDiscovery = /\${*(.*)}/;

    for(let i=0; i<mcArgs.length; ++i){
        if(argDiscovery.test(mcArgs[i])){
            const identifier = mcArgs[i].match(argDiscovery)[1];
            let val = null;
            switch(identifier){
                case 'auth_player_name':
                    val = context.authUser.displayName.trim();
                    break;
                case 'version_name':
                    val = context.server.rawServer.id;
                    break;
                case 'game_directory':
                    val = context.gameDir;
                    break;
                case 'assets_root':
                    val = path.join(context.commonDir, 'assets');
                    break;
                case 'assets_index_name':
                    val = context.vanillaManifest.assets;
                    break;
                case 'auth_uuid':
                    val = context.authUser.uuid.trim();
                    break;
                case 'auth_access_token':
                    val = context.authUser.accessToken;
                    break;
                case 'user_type':
                    val = context.authUser.type === 'microsoft' ? 'msa' : 'mojang';
                    break;
                case 'user_properties': // 1.8.9 and below.
                    val = '{}';
                    break;
                case 'version_type':
                    val = context.vanillaManifest.type;
                    break;
            }
            if(val != null){
                mcArgs[i] = val;
            }
        }
    }

    _processAutoConnectArg(context, mcArgs);

    if(ConfigManager.getFullscreen()){
        mcArgs.push('--fullscreen');
        mcArgs.push(true);
    } else {
        mcArgs.push('--width');
        mcArgs.push(ConfigManager.getGameWidth());
        mcArgs.push('--height');
        mcArgs.push(ConfigManager.getGameHeight());
    }

    mcArgs.push('--modListFile');
    if(_lteMinorVersion(context, 9)) {
        mcArgs.push(path.basename(context.fmlDir));
    } else {
        mcArgs.push('absolute:' + context.fmlDir);
    }

    if(context.usingLiteLoader){
        mcArgs.push('--modRepo');
        mcArgs.push(context.llDir);
        mcArgs.unshift('com.mumfrey.liteloader.launch.LiteLoaderTweaker');
        mcArgs.unshift('--tweakClass');
    }

    return mcArgs;
}

// Internal helper function
function _constructJVMArguments112(context, mods, tempNativePath){
    let args = [];
    args.push('-cp');
    args.push(classpathArg(context, mods, tempNativePath).join(getClasspathSeparator())); // Updated call

    if(process.platform === 'darwin'){
        args.push('-Xdock:name=FLauncher');
        args.push('-Xdock:icon=' + path.join(__dirname, '..', '..', 'images', 'minecraft.icns'));
    }
    args.push('-Xmx' + ConfigManager.getMaxRAM(context.server.rawServer.id));
    args.push('-Xms' + ConfigManager.getMinRAM(context.server.rawServer.id));
    args = args.concat(ConfigManager.getJVMOptions(context.server.rawServer.id));
    args.push('-Djava.library.path=' + tempNativePath);
    args.push(context.modManifest.mainClass);
    args = args.concat(_resolveForgeArgs(context));
    return args;
}

// Internal helper function
function _constructJVMArguments113(context, mods, tempNativePath){
    const argDiscovery = /\${*(.*)}/;
    let args = context.vanillaManifest.arguments.jvm;

    if(context.modManifest.arguments.jvm != null) {
        for(const argStr of context.modManifest.arguments.jvm) {
            args.push(argStr
                .replaceAll('${library_directory}', context.libPath)
                .replaceAll('${classpath_separator}', getClasspathSeparator())
                .replaceAll('${version_name}', context.modManifest.id)
            );
        }
    }

    if(process.platform === 'darwin'){
        args.push('-Xdock:name=FLauncher');
        args.push('-Xdock:icon=' + path.join(__dirname, '..', '..', 'images', 'minecraft.icns'));
    }
    args.push('-Xmx' + ConfigManager.getMaxRAM(context.server.rawServer.id));
    args.push('-Xms' + ConfigManager.getMinRAM(context.server.rawServer.id));
    args = args.concat(ConfigManager.getJVMOptions(context.server.rawServer.id));
    args.push(context.modManifest.mainClass);
    args = args.concat(context.vanillaManifest.arguments.game);

    for(let i=0; i<args.length; i++){
        if(typeof args[i] === 'object' && args[i].rules != null){
            let checksum = 0;
            for(let rule of args[i].rules){
                if(rule.os != null){
                    if(rule.os.name === getMojangOS()
                        && (rule.os.version == null || new RegExp(rule.os.version).test(os.release))){
                        if(rule.action === 'allow'){ checksum++; }
                    } else {
                        if(rule.action === 'disallow'){ checksum++; }
                    }
                } else if(rule.features != null){
                    if(rule.features.has_custom_resolution != null && rule.features.has_custom_resolution === true){
                        if(ConfigManager.getFullscreen()){
                            args[i].value = ['--fullscreen', 'true'];
                        }
                        checksum++;
                    }
                }
            }
            if(checksum === args[i].rules.length){
                if(typeof args[i].value === 'string'){ args[i] = args[i].value; }
                else if(typeof args[i].value === 'object'){ args.splice(i, 1, ...args[i].value); }
                i--;
            } else {
                args[i] = null;
            }
        } else if(typeof args[i] === 'string'){
            if(argDiscovery.test(args[i])){
                const identifier = args[i].match(argDiscovery)[1];
                let val = null;
                switch(identifier){
                    case 'auth_player_name': val = context.authUser.displayName.trim(); break;
                    case 'version_name': val = context.server.rawServer.id; break;
                    case 'game_directory': val = context.gameDir; break;
                    case 'assets_root': val = path.join(context.commonDir, 'assets'); break;
                    case 'assets_index_name': val = context.vanillaManifest.assets; break;
                    case 'auth_uuid': val = context.authUser.uuid.trim(); break;
                    case 'auth_access_token': val = context.authUser.accessToken; break;
                    case 'user_type': val = context.authUser.type === 'microsoft' ? 'msa' : 'mojang'; break;
                    case 'version_type': val = context.vanillaManifest.type; break;
                    case 'resolution_width': val = ConfigManager.getGameWidth(); break;
                    case 'resolution_height': val = ConfigManager.getGameHeight(); break;
                    case 'natives_directory': val = args[i].replace(argDiscovery, tempNativePath); break;
                    case 'launcher_name': val = args[i].replace(argDiscovery, 'FLauncher'); break;
                    case 'launcher_version': val = args[i].replace(argDiscovery, context.launcherVersion); break;
                    case 'classpath': val = classpathArg(context, mods, tempNativePath).join(getClasspathSeparator()); break; // Updated call
                }
                if(val != null){ args[i] = val; }
            }
        }
    }
    _processAutoConnectArg(context, args);
    args = args.concat(context.modManifest.arguments.game);
    args = args.filter(arg => arg != null);
    return args;
}

/**
 * Construct the argument array that will be passed to the JVM process.
 * @param {Object} context The ProcessBuilder instance.
 * @param {Array.<Object>} mods An array of enabled mods which will be launched with this process.
 * @param {string} tempNativePath The path to store the native libraries.
 * @returns {Array.<string>} An array containing the full JVM arguments for this process.
 */
function constructJVMArguments(context, mods, tempNativePath){
    if(mcVersionAtLeast('1.13', context.server.rawServer.minecraftVersion)){
        return _constructJVMArguments113(context, mods, tempNativePath);
    } else {
        return _constructJVMArguments112(context, mods, tempNativePath);
    }
}

module.exports = {
    constructJVMArguments
};
