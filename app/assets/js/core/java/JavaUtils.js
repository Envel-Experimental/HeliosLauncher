const path = require('path');

const Platform = {
    WIN32: 'win32',
    DARWIN: 'darwin',
    LINUX: 'linux'
};

function javaExecFromRoot(rootDir) {
    switch (process.platform) {
        case Platform.WIN32:
            return path.join(rootDir, 'bin', 'javaw.exe');
        case Platform.DARWIN:
            return path.join(rootDir, 'Contents', 'Home', 'bin', 'java');
        case Platform.LINUX:
            return path.join(rootDir, 'bin', 'java');
        default:
            return rootDir;
    }
}

function ensureJavaDirIsRoot(dir) {
    switch (process.platform) {
        case Platform.DARWIN: {
            const index = dir.indexOf('/Contents/Home');
            return index > -1 ? dir.substring(0, index) : dir;
        }
        case Platform.WIN32:
        case Platform.LINUX:
        default: {
            const index = dir.indexOf(path.join('/', 'bin', 'java'));
            if (index === -1) {
                const winIndex = dir.indexOf(path.join('\\', 'bin', 'javaw.exe'));
                return winIndex > -1 ? dir.substring(0, winIndex) : dir;
            }
            return index > -1 ? dir.substring(0, index) : dir;
        }
    }
}

module.exports = {
    javaExecFromRoot,
    ensureJavaDirIsRoot,
    Platform
};
