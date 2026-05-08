const os = require('os')

function getMojangOS() {
    const opSys = process.platform;
    switch (opSys) {
        case 'darwin':
            return 'osx';
        case 'win32':
            return 'windows';
        case 'linux':
            return 'linux';
        default:
            return opSys;
    }
}

function validateLibraryRules(rules) {
    if (rules == null) return false
    let result = false
    for (const rule of rules) {
        let match = true
        if (rule.os != null) {
            if (rule.os.name != null && rule.os.name !== getMojangOS()) {
                match = false
            }
            if (rule.os.arch != null && rule.os.arch !== process.arch) {
                if (!(rule.os.arch === 'aarch64' && process.arch === 'arm64')) {
                    match = false
                }
            }
            if (rule.os.version != null) {
                try {
                    const reg = new RegExp(rule.os.version)
                    if (!reg.test(os.release())) {
                        match = false
                    }
                } catch (e) { }
            }
        }
        if (match) {
            result = rule.action === 'allow'
        } else if (rule.action === 'disallow') {
            result = true
        }
    }
    return result
}

function validateLibraryNatives(natives) {
    return natives == null ? true : Object.prototype.hasOwnProperty.call(natives, getMojangOS());
}

function isLibraryCompatible(rules, natives) {
    if (rules == null && natives == null) return true;
    if (rules != null) return validateLibraryRules(rules);
    return validateLibraryNatives(natives);
}

function mcVersionAtLeast(desired, actual) {
    if (!desired || !actual) {
        return false;
    }
    const des = desired.split('.');
    const act = actual.split('.');
    if (act.length < des.length) {
        for (let i = act.length; i < des.length; i++) {
            act[i] = '0';
        }
    }
    for (let i = 0; i < des.length; i++) {
        const parsedDesired = parseInt(des[i]);
        const parsedActual = parseInt(act[i]);
        if (parsedActual > parsedDesired) {
            return true;
        }
        else if (parsedActual < parsedDesired) {
            return false;
        }
    }
    return true;
}

module.exports = { getMojangOS, validateLibraryRules, validateLibraryNatives, isLibraryCompatible, mcVersionAtLeast }
