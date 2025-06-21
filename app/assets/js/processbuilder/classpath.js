// Classpath construction logic
const AdmZip = require('adm-zip')
const fs = require('fs-extra')
const path = require('path')
const { isLibraryCompatible, getMojangOS, mcVersionAtLeast } = require('helios-core/common')
const { Type } = require('helios-distribution-types')
const logger = require('./modules/logging') // Assuming centralized logger

// Internal helper function
function _processClassPathList(config, list) { // Takes ProcessConfiguration
    const ext = '.jar'
    const extLen = ext.length
    for(let i=0; i<list.length; i++) {
        const extIndex = list[i].indexOf(ext)
        if(extIndex > -1 && extIndex  !== list[i].length - extLen) {
            list[i] = list[i].substring(0, extIndex + extLen)
        }
    }
}

// Internal helper function
function _resolveModuleLibraries(config, mdl){ // Takes ProcessConfiguration, mdl is the current module
    if(!mdl.subModules || !mdl.subModules.length > 0){
        return {}
    }
    let libs = {}
    for(let sm of mdl.subModules){
        if(sm.rawModule.type === Type.Library){
            if(sm.rawModule.classpath ?? true) { // Check if classpath is explicitly false
                libs[sm.getVersionlessMavenIdentifier()] = sm.getPath()
            }
        }
        if(sm.subModules && sm.subModules.length > 0){
            const res = _resolveModuleLibraries(config, sm) // Pass config
            libs = {...libs, ...res}
        }
    }
    return libs
}

// Internal helper function
function _resolveServerLibraries(config, mods){ // Takes ProcessConfiguration
    const mdls = config.getServer().modules
    let libs = {}

    for(let mdl of mdls){
        const type = mdl.rawModule.type
        // ForgeHosted was for older Forge, ensure Type.ForgeMod is also considered if it can have libs.
        // Fabric loader itself might also be a library.
        if(type === Type.ForgeHosted || type === Type.Fabric || type === Type.Library || type === Type.ForgeMod){
            if (mdl.rawModule.classpath ?? true) {
                libs[mdl.getVersionlessMavenIdentifier()] = mdl.getPath()
            }
            if(mdl.subModules && mdl.subModules.length > 0){
                const res = _resolveModuleLibraries(config, mdl) // Pass config
                libs = {...libs, ...res}
            }
        }
    }

    // Resolve libraries from explicitly passed mods (e.g. ForgeMod, LiteMod)
    // if they themselves contain further library submodules.
    for(let i=0; i<mods.length; i++){
        if(mods[i].subModules != null && mods[i].subModules.length > 0){
            const res = _resolveModuleLibraries(config, mods[i]) // Pass config
            libs = {...libs, ...res}
        }
    }
    return libs
}

// Internal helper function
function _resolveMojangLibraries(config, tempNativePath){ // Takes ProcessConfiguration
    const nativesRegex = /.+:natives-([^-]+)(?:-(.+))?/
    const libs = {}
    const libArr = config.getVanillaManifest().libraries
    fs.ensureDirSync(tempNativePath)

    for(let i=0; i<libArr.length; i++){
        const lib = libArr[i]
        if(isLibraryCompatible(lib.rules, lib.natives)){ // isLibraryCompatible is from helios-core
            if(lib.natives != null) { // Pre-1.19 style natives
                const exclusionArr = lib.extract != null ? lib.extract.exclude : ['META-INF/']
                let nativeKey = lib.natives[getMojangOS()] // getMojangOS from helios-core
                if (nativeKey) {
                    nativeKey = nativeKey.replace('${arch}', process.arch === 'ia32' ? '32' : '64')
                }

                const artifact = lib.downloads.classifiers[nativeKey]
                if(!artifact) {
                    logger.warn(`Native artifact not found for ${lib.name} on OS ${getMojangOS()} with key ${nativeKey}`)
                    continue
                }

                const to = path.join(config.getLibraryPath(), artifact.path) // Use config.getLibraryPath()
                try {
                    let zip = new AdmZip(to)
                    let zipEntries = zip.getEntries()
                    for(let j=0; j<zipEntries.length; j++){
                        const fileName = zipEntries[j].entryName
                        let shouldExclude = false
                        exclusionArr.forEach(function(exclusion){
                            if(fileName.indexOf(exclusion) > -1){
                                shouldExclude = true
                            }
                        })
                        if(!shouldExclude){
                            // Asynchronous, but original was like this. Consider if this needs to be sync for classpath construction.
                            // For now, keeping behavior. If classpath relies on extraction finishing, this is a bug.
                            fs.writeFile(path.join(tempNativePath, fileName), zipEntries[j].getData(), (err) => {
                                if(err){
                                    logger.error('Error while extracting native library:', lib.name, err)
                                }
                            })
                        }
                    }
                } catch (err) {
                    logger.error('Error processing zip file for native library:', to, lib.name, err)
                }
            }
            else if(lib.name.includes('natives-')) { // For 1.19+ style natives
                const regexTest = nativesRegex.exec(lib.name)
                if (!regexTest) { // Should not happen if name.includes is true, but good guard
                    logger.warn(`Could not parse native library name: ${lib.name}`)
                    continue
                }
                const osName = regexTest[1]
                const archName = regexTest[2] || null

                let currentOS = getMojangOS()
                let currentArch = process.arch

                let manifestArch = null
                if (archName === 'x86') manifestArch = 'ia32'
                else if (archName === 'x64') manifestArch = 'x64'
                else if (archName === 'arm64') manifestArch = 'arm64'

                let osMatches = (osName === currentOS)
                let archMatches = (manifestArch === null || manifestArch === currentArch)

                // Special handling for osx arm64 when manifest might not specify arch (e.g. "natives-osx")
                if (currentOS === 'osx' && currentArch === 'arm64' && manifestArch === null && osName === 'osx') {
                    archMatches = true
                }

                if (!osMatches || !archMatches) {
                    continue // Not for this OS/Arch combination
                }

                const exclusionArr = lib.extract != null ? lib.extract.exclude : ['META-INF/', '.git', '.sha1']
                const artifact = lib.downloads.artifact
                if(!artifact) {
                    logger.warn(`Native artifact (1.19+) not found for ${lib.name}`)
                    continue
                }
                const to = path.join(config.getLibraryPath(), artifact.path) // Use config.getLibraryPath()
                try {
                    let zip = new AdmZip(to)
                    let zipEntries = zip.getEntries()
                    for(let j=0; j<zipEntries.length; j++){
                        if(zipEntries[j].isDirectory) {
                            continue
                        }
                        const fileName = zipEntries[j].entryName
                        let shouldExclude = false
                        exclusionArr.forEach(function(exclusion){
                            if(fileName.indexOf(exclusion) > -1){
                                shouldExclude = true
                            }
                        })
                        // Ensure extracted name is just the filename, not full path from zip
                        const extractName = path.basename(fileName)
                        if(!shouldExclude){
                            fs.writeFile(path.join(tempNativePath, extractName), zipEntries[j].getData(), (err) => {
                                if(err){
                                    logger.error('Error while extracting native library (1.19+):', lib.name, err)
                                }
                            })
                        }
                    }
                } catch (err) {
                    logger.error('Error processing zip file for native library (1.19+):', to, lib.name, err)
                }
            }
            else { // Regular library (not a native)
                const dlInfo = lib.downloads
                const artifact = dlInfo.artifact
                if(!artifact) {
                    logger.warn(`Artifact not found for library ${lib.name}`)
                    continue
                }
                const libraryPath = path.join(config.getLibraryPath(), artifact.path) // Use config.getLibraryPath()
                const versionIndependentId = lib.name.substring(0, lib.name.lastIndexOf(':')) // Example: com.mojang:patchy
                libs[versionIndependentId] = libraryPath
            }
        }
    }
    return libs
}

/**
 * Resolve the full classpath argument list for this process.
 * @param {ProcessConfiguration} config The ProcessConfiguration instance.
 * @param {Array.<Object>} mods An array of enabled mods.
 * @param {string} tempNativePath The path to store native libraries.
 * @returns {Array.<string>} An array containing the paths of each library.
 */
function classpathArg(config, mods, tempNativePath){
    let cpArgs = []

    // Include the Minecraft client JAR unless it's MC 1.17+ AND not using Fabric.
    // Fabric for 1.17+ still needs the client JAR in the classpath.
    if(!mcVersionAtLeast('1.17', config.getVanillaManifest().id) || config.isUsingFabricLoader()) {
        const version = config.getVanillaManifest().id
        cpArgs.push(path.join(config.getCommonDirectory(), 'versions', version, version + '.jar'))
    }

    if(config.isUsingLiteLoader()){
        cpArgs.push(config.getLiteLoaderPath())
    }

    const mojangLibs = _resolveMojangLibraries(config, tempNativePath) // Pass config
    const servLibs = _resolveServerLibraries(config, mods) // Pass config

    // Merge libraries, server libraries override Mojang ones if keys conflict.
    const finalLibs = {...mojangLibs, ...servLibs}
    cpArgs = cpArgs.concat(Object.values(finalLibs))

    _processClassPathList(config, cpArgs) // Modifies cpArgs in place, pass config
    return cpArgs
}

module.exports = {
    classpathArg
}
