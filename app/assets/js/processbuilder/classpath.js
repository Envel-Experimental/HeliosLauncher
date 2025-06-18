// Classpath construction logic
const AdmZip = require('adm-zip');
const fs = require('fs-extra');
const path = require('path');
const { isLibraryCompatible, getMojangOS, mcVersionAtLeast } = require('helios-core/common');
const { Type } = require('helios-distribution-types');

// Internal helper function
function _processClassPathList(context, list) {
    const ext = '.jar';
    const extLen = ext.length;
    for(let i=0; i<list.length; i++) {
        const extIndex = list[i].indexOf(ext);
        if(extIndex > -1 && extIndex  !== list[i].length - extLen) {
            list[i] = list[i].substring(0, extIndex + extLen);
        }
    }
}

// Internal helper function
function _resolveModuleLibraries(context, mdl){ // mdl is the current module being processed
    if(!mdl.subModules || !mdl.subModules.length > 0){ // Guard for current mdl
        return {};
    }
    let libs = {};
    for(let sm of mdl.subModules){ // Iterate over submodules of current mdl
        if(sm.rawModule.type === Type.Library){
            if(sm.rawModule.classpath ?? true) {
                libs[sm.getVersionlessMavenIdentifier()] = sm.getPath();
            }
        }
        // Recursive call for the subModule sm IF IT HAS subModules
        if(sm.subModules && sm.subModules.length > 0){
            const res = _resolveModuleLibraries(context, sm);
            libs = {...libs, ...res};
        }
    }
    return libs;
}

// Internal helper function
function _resolveServerLibraries(context, mods){
    const mdls = context.server.modules;
    let libs = {};

    for(let mdl of mdls){
        const type = mdl.rawModule.type;
        if(type === Type.ForgeHosted || type === Type.Fabric || type === Type.Library){
            libs[mdl.getVersionlessMavenIdentifier()] = mdl.getPath();
            if(mdl.subModules && mdl.subModules.length > 0){ // Check current mdl for submodules
                const res = _resolveModuleLibraries(context, mdl);
                libs = {...libs, ...res};
            }
        }
    }

    for(let i=0; i<mods.length; i++){
        if(mods[i].subModules != null && mods[i].subModules.length > 0){
            const res = _resolveModuleLibraries(context, mods[i]);
            libs = {...libs, ...res};
        }
    }
    return libs;
}

// Internal helper function
function _resolveMojangLibraries(context, tempNativePath){
    const nativesRegex = /.+:natives-([^-]+)(?:-(.+))?/;
    const libs = {};
    const libArr = context.vanillaManifest.libraries;
    fs.ensureDirSync(tempNativePath);

    for(let i=0; i<libArr.length; i++){
        const lib = libArr[i];
        if(isLibraryCompatible(lib.rules, lib.natives)){
            if(lib.natives != null) {
                const exclusionArr = lib.extract != null ? lib.extract.exclude : ['META-INF/'];
                // Original: lib.natives[getMojangOS()].replace('${arch}', process.arch.replace('x', ''))
                // Current process.arch can be x64, ia32, arm64. Vanilla manifest ${arch} is usually 64 or 32.
                let nativeKey = lib.natives[getMojangOS()];
                if (nativeKey) {
                    nativeKey = nativeKey.replace('${arch}', process.arch === 'ia32' ? '32' : '64');
                }

                const artifact = lib.downloads.classifiers[nativeKey];
                if(!artifact) {
                    // console.warn(`Native artifact not found for ${lib.name} on OS ${getMojangOS()} with key ${nativeKey}`);
                    continue;
                }

                const to = path.join(context.libPath, artifact.path);
                try {
                    let zip = new AdmZip(to);
                    let zipEntries = zip.getEntries();
                    for(let j=0; j<zipEntries.length; j++){
                        const fileName = zipEntries[j].entryName;
                        let shouldExclude = false;
                        exclusionArr.forEach(function(exclusion){
                            if(fileName.indexOf(exclusion) > -1){
                                shouldExclude = true;
                            }
                        });
                        if(!shouldExclude){
                            fs.writeFile(path.join(tempNativePath, fileName), zipEntries[j].getData(), (err) => {
                                if(err){
                                    // console.error('Error while extracting native library:', lib.name, err);
                                }
                            });
                        }
                    }
                } catch (err) {
                    // console.error('Error processing zip file for native library:', to, lib.name, err);
                }
            }
            else if(lib.name.includes('natives-')) { // For 1.19+ style natives
                const regexTest = nativesRegex.exec(lib.name);
                const osName = regexTest[1];
                const archName = regexTest[2] || null; // e.g., null for osx-arm64, or 'x86' for windows-x86

                let currentOS = getMojangOS();
                let currentArch = process.arch; // x64, ia32, arm64

                // Normalize arch names for comparison
                let manifestArch = null;
                if (archName === 'x86') manifestArch = 'ia32';
                if (archName === 'x64') manifestArch = 'x64';
                if (archName === 'arm64') manifestArch = 'arm64';
                 // if archName is null (e.g. natives-osx without specific arch, often means universal or matches primary arch like arm64 on M1)
                if (osName === currentOS && (manifestArch === null || manifestArch === currentArch || (currentOS === 'osx' && manifestArch === null && currentArch === 'arm64'))) {
                    // Matches current OS and Arch (or arch is null and implies compatibility)
                } else if (osName !== currentOS) {
                    continue; // Not for this OS
                } else if (manifestArch && manifestArch !== currentArch) {
                     continue; // OS matches but arch does not
                }


                const exclusionArr = lib.extract != null ? lib.extract.exclude : ['META-INF/', '.git', '.sha1'];
                const artifact = lib.downloads.artifact;
                if(!artifact) {
                    // console.warn(`Native artifact (1.19+) not found for ${lib.name}`);
                    continue;
                }
                const to = path.join(context.libPath, artifact.path);
                 try {
                    let zip = new AdmZip(to);
                    let zipEntries = zip.getEntries();
                    for(let j=0; j<zipEntries.length; j++){
                        if(zipEntries[j].isDirectory) {
                            continue;
                        }
                        const fileName = zipEntries[j].entryName;
                        let shouldExclude = false;
                        exclusionArr.forEach(function(exclusion){
                            if(fileName.indexOf(exclusion) > -1){
                                shouldExclude = true;
                            }
                        });
                        const extractName = fileName.includes('/') ? fileName.substring(fileName.lastIndexOf('/')) : fileName;
                        if(!shouldExclude){
                           fs.writeFile(path.join(tempNativePath, extractName), zipEntries[j].getData(), (err) => {
                                if(err){
                                    // console.error('Error while extracting native library (1.19+):', lib.name, err);
                                }
                            });
                        }
                    }
                } catch (err) {
                    // console.error('Error processing zip file for native library (1.19+):', to, lib.name, err);
                }
            }
            else { // Regular library
                const dlInfo = lib.downloads;
                const artifact = dlInfo.artifact;
                if(!artifact) {
                     // console.warn(`Artifact not found for library ${lib.name}`);
                    continue;
                }
                const to = path.join(context.libPath, artifact.path);
                const versionIndependentId = lib.name.substring(0, lib.name.lastIndexOf(':'));
                libs[versionIndependentId] = to;
            }
        }
    }
    return libs;
}

/**
 * Resolve the full classpath argument list for this process.
 * @param {Object} context The ProcessBuilder instance.
 * @param {Array.<Object>} mods An array of enabled mods.
 * @param {string} tempNativePath The path to store native libraries.
 * @returns {Array.<string>} An array containing the paths of each library.
 */
function classpathArg(context, mods, tempNativePath){
    let cpArgs = [];

    if(!mcVersionAtLeast('1.17', context.server.rawServer.minecraftVersion) || context.usingFabricLoader) {
        const version = context.vanillaManifest.id;
        cpArgs.push(path.join(context.commonDir, 'versions', version, version + '.jar'));
    }

    if(context.usingLiteLoader){
        cpArgs.push(context.llPath);
    }

    const mojangLibs = _resolveMojangLibraries(context, tempNativePath);
    const servLibs = _resolveServerLibraries(context, mods);
    const finalLibs = {...mojangLibs, ...servLibs};
    cpArgs = cpArgs.concat(Object.values(finalLibs));
    _processClassPathList(context, cpArgs); // Modifies cpArgs in place
    return cpArgs;
}

module.exports = {
    classpathArg
};
