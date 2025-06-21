// JVM argument construction logic
const os = require('os')
const path = require('path')
const ConfigManager = require('../configmanager') // Global settings access
const { getMojangOS, mcVersionAtLeast } = require('helios-core/common')
const { getClasspathSeparator } = require('./utils')
const { classpathArg } = require('./classpath') // Will also be refactored to use config

// Internal helper function - No longer needed here if ProcessConfiguration handles version logic or if not used.
// For now, assuming it might be specific to JVM arg logic if it parses modManifest for tweaks.
function _lteMinorVersion(config, version) {
    // Assuming modManifest.id is like "1.12.2-forge-..." or "1.12.2"
    const mcVersionFromFile = config.getModManifest().id.split('-')[0]
    return Number(mcVersionFromFile.split('.')[1]) <= Number(version)
}

// Internal helper function
function _processAutoConnectArg(config, args){
    const serverConfig = config.getServer() // Get the server object from ProcessConfiguration
    if(ConfigManager.getAutoConnect() && serverConfig.rawServer.autoconnect){
        if(mcVersionAtLeast('1.20', serverConfig.rawServer.minecraftVersion)){
            args.push('--quickPlayMultiplayer')
            args.push(`${serverConfig.hostname}:${serverConfig.port}`)
        } else {
            args.push('--server')
            args.push(serverConfig.hostname)
            args.push('--port')
            args.push(serverConfig.port)
        }
    }
}

// Internal helper function
function _resolveForgeArgs(config){ // Takes ProcessConfiguration instance
    const mcArgs = config.getModManifest().minecraftArguments.split(' ')
    const argDiscovery = /\${*(.*)}/
    const authUser = config.getAuthUser()
    const server = config.getServer()
    const vanillaManifest = config.getVanillaManifest()

    for(let i=0; i<mcArgs.length; ++i){
        if(argDiscovery.test(mcArgs[i])){
            const identifier = mcArgs[i].match(argDiscovery)[1]
            let val = null
            switch(identifier){
                case 'auth_player_name':
                    val = authUser.displayName.trim() // Assuming selectedProfile.name is displayName
                    break
                case 'version_name':
                    val = server.rawServer.id
                    break
                case 'game_directory':
                    val = config.getGameDirectory()
                    break
                case 'assets_root':
                    val = path.join(config.getCommonDirectory(), 'assets')
                    break
                case 'assets_index_name':
                    val = vanillaManifest.assets
                    break
                case 'auth_uuid':
                    val = authUser.uuid.trim()
                    break
                case 'auth_access_token':
                    val = authUser.accessToken
                    break
                case 'user_type':
                    val = authUser.type === 'microsoft' ? 'msa' : 'mojang'
                    break
                case 'user_properties': // 1.8.9 and below.
                    val = '{}'
                    break
                case 'version_type':
                    val = vanillaManifest.type
                    break
            }
            if(val != null){
                mcArgs[i] = val
            }
        }
    }

    _processAutoConnectArg(config, mcArgs)

    if(ConfigManager.getFullscreen()){ // Global ConfigManager setting
        mcArgs.push('--fullscreen')
        mcArgs.push(true)
    } else {
        mcArgs.push('--width')
        mcArgs.push(ConfigManager.getGameWidth()) // Global
        mcArgs.push('--height')
        mcArgs.push(ConfigManager.getGameHeight()) // Global
    }

    mcArgs.push('--modListFile')
    if(_lteMinorVersion(config, 9)) { // Uses config
        mcArgs.push(path.basename(config.getFmlDirectory())) // Path from ProcessConfiguration
    } else {
        mcArgs.push('absolute:' + config.getFmlDirectory()) // Path from ProcessConfiguration
    }

    if(config.isUsingLiteLoader()){ // State from ProcessConfiguration
        mcArgs.push('--modRepo')
        mcArgs.push(config.getLiteLoaderDirectory()) // Path from ProcessConfiguration
        mcArgs.unshift('com.mumfrey.liteloader.launch.LiteLoaderTweaker')
        mcArgs.unshift('--tweakClass')
    }

    return mcArgs
}

// Internal helper function
function _constructJVMArguments112(config, mods, tempNativePath){ // Takes ProcessConfiguration
    let args = []
    args.push('-cp')
    args.push(classpathArg(config, mods, tempNativePath).join(getClasspathSeparator())) // classpathArg will also take config

    if(process.platform === 'darwin'){
        args.push('-Xdock:name=FLauncher')
        // Assuming images path is relative to the application root, not this specific file
        args.push('-Xdock:icon=' + path.join(ConfigManager.getLauncherDirectory(), 'app', 'assets', 'images', 'minecraft.icns'))
    }
    args.push('-Xmx' + ConfigManager.getMaxRAM(config.getServer().rawServer.id)) // Global
    args.push('-Xms' + ConfigManager.getMinRAM(config.getServer().rawServer.id)) // Global
    args = args.concat(ConfigManager.getJVMOptions(config.getServer().rawServer.id)) // Global
    args.push('-Djava.library.path=' + tempNativePath)
    args.push(config.getModManifest().mainClass)
    args = args.concat(_resolveForgeArgs(config)) // Uses config
    return args
}

// Internal helper function
function _constructJVMArguments113(config, mods, tempNativePath){ // Takes ProcessConfiguration
    const argDiscovery = /\${*(.*)}/
    let args = config.getVanillaManifest().arguments.jvm.slice() // Use slice to clone

    const modManifest = config.getModManifest()
    if(modManifest.arguments && modManifest.arguments.jvm != null) {
        for(const argStr of modManifest.arguments.jvm) {
            args.push(argStr
                .replaceAll('${library_directory}', config.getLibraryPath()) // Path from ProcessConfiguration
                .replaceAll('${classpath_separator}', getClasspathSeparator())
                .replaceAll('${version_name}', modManifest.id)
            )
        }
    }

    if(process.platform === 'darwin'){
        args.push('-Xdock:name=FLauncher')
        args.push('-Xdock:icon=' + path.join(ConfigManager.getLauncherDirectory(), 'app', 'assets', 'images', 'minecraft.icns'))
    }
    args.push('-Xmx' + ConfigManager.getMaxRAM(config.getServer().rawServer.id)) // Global
    args.push('-Xms' + ConfigManager.getMinRAM(config.getServer().rawServer.id)) // Global
    args = args.concat(ConfigManager.getJVMOptions(config.getServer().rawServer.id)) // Global
    args.push(modManifest.mainClass)

    if(config.getVanillaManifest().arguments.game) {
        args = args.concat(config.getVanillaManifest().arguments.game)
    }


    const authUser = config.getAuthUser()
    const server = config.getServer()
    const vanillaManifest = config.getVanillaManifest()

    for(let i=0; i<args.length; i++){
        if(typeof args[i] === 'object' && args[i].rules != null){
            let checksum = 0
            for(let rule of args[i].rules){
                if(rule.os != null){
                    if(rule.os.name === getMojangOS()
                        && (rule.os.version == null || new RegExp(rule.os.version).test(os.release()))){
                        if(rule.action === 'allow'){ checksum++ }
                    } else {
                        if(rule.action === 'disallow'){ checksum++ } // This logic seems off, disallow should count if os does NOT match
                        // Or, if os matches AND action is disallow, then it's a skip.
                        // For now, keeping original logic.
                    }
                } else if(rule.features != null){
                    // Example: { "name": "has_custom_resolution", "value": true }
                    if(rule.features.has_custom_resolution != null && rule.features.has_custom_resolution === true){
                        if(ConfigManager.getFullscreen()){ // Global
                            args[i].value = ['--fullscreen', 'true'] // This should replace the current arg or insert new ones.
                        } else {
                            args[i].value = ['--width', ConfigManager.getGameWidth(), '--height', ConfigManager.getGameHeight()]
                        }
                        checksum++ // Assuming this rule is now satisfied.
                    }
                }
            }

            if(checksum === args[i].rules.length){ // If all rules satisfied (or allowed by os mismatch)
                if(typeof args[i].value === 'string'){ args[i] = args[i].value }
                else if(Array.isArray(args[i].value)){ args.splice(i, 1, ...args[i].value); i-- } // Spread array values, adjust index
                else { args[i] = null } // If value is not string or array, remove (or handle as error)
            } else {
                args[i] = null // Rule not satisfied, remove argument.
            }

        } else if(typeof args[i] === 'string'){
            if(argDiscovery.test(args[i])){
                const identifier = args[i].match(argDiscovery)[1]
                let val = null
                switch(identifier){
                    case 'auth_player_name': val = authUser.displayName.trim(); break
                    case 'version_name': val = server.rawServer.id; break // Or vanillaManifest.id or modManifest.id depending on context
                    case 'game_directory': val = config.getGameDirectory(); break
                    case 'assets_root': val = path.join(config.getCommonDirectory(), 'assets'); break
                    case 'assets_index_name': val = vanillaManifest.assets; break
                    case 'auth_uuid': val = authUser.uuid.trim(); break
                    case 'auth_access_token': val = authUser.accessToken; break
                    case 'user_type': val = authUser.type === 'microsoft' ? 'msa' : 'mojang'; break
                    case 'version_type': val = vanillaManifest.type; break
                    case 'resolution_width': val = ConfigManager.getGameWidth(); break // Global
                    case 'resolution_height': val = ConfigManager.getGameHeight(); break // Global
                    // Replace placeholder directly if it's the whole string
                    case 'natives_directory': val = tempNativePath; break
                    case 'launcher_name': val = 'FLauncher'; break
                    case 'launcher_version': val = config.getLauncherVersion(); break
                    case 'classpath': val = classpathArg(config, mods, tempNativePath).join(getClasspathSeparator()); break
                }
                if(val != null) {
                    // If identifier is the whole string, replace. Otherwise, interpolate.
                    if (args[i] === `\${${identifier}}`) {
                        args[i] = val
                    } else {
                        args[i] = args[i].replace(`\${${identifier}}`, val)
                    }
                }
            }
        }
    }
    _processAutoConnectArg(config, args) // Uses config

    if(modManifest.arguments && modManifest.arguments.game) {
        args = args.concat(modManifest.arguments.game)
    }

    args = args.filter(arg => arg != null)
    return args
}

/**
 * Construct the argument array that will be passed to the JVM process.
 * @param {ProcessConfiguration} config The ProcessConfiguration instance.
 * @param {Array.<Object>} mods An array of enabled mods which will be launched with this process.
 * @param {string} tempNativePath The path to store the native libraries.
 * @returns {Array.<string>} An array containing the full JVM arguments for this process.
 */
function constructJVMArguments(config, mods, tempNativePath){
    // Use vanilla manifest's ID for version check, as modManifest might not always be reliable for MC base version
    if(mcVersionAtLeast('1.13', config.getVanillaManifest().id)){
        return _constructJVMArguments113(config, mods, tempNativePath)
    } else {
        return _constructJVMArguments112(config, mods, tempNativePath)
    }
}

module.exports = {
    constructJVMArguments
}
