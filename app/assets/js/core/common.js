
const { createLogger, format, transports } = require('winston');
const { SPLAT } = require('triple-beam');
const { DateTime } = require('luxon');
const { inspect } = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fastq = require('fastq');
const StreamZip = require('node-stream-zip');
const zlib = require('zlib');
const tar = require('tar-fs');

// LoggerUtil
class LoggerUtil {
    static getLogger(label) {
        return createLogger({
            format: format.combine(
                format.label(),
                format.colorize(),
                format.label({ label }),
                format.printf(info => {
                    if (info[SPLAT]) {
                        if (info[SPLAT].length === 1 && info[SPLAT][0] instanceof Error) {
                            const err = info[SPLAT][0];
                            if (info.message.length > err.message.length && info.message.endsWith(err.message)) {
                                info.message = info.message.substring(0, info.message.length - err.message.length);
                            }
                        } else if (info[SPLAT].length > 0) {
                            info.message += ' ' + info[SPLAT].map(it => {
                                if (typeof it === 'object' && it != null) {
                                    return inspect(it, false, null, true);
                                }
                                return it;
                            }).join(' ');
                        }
                    }
                    return `[${DateTime.local().toFormat('yyyy-MM-dd TT').trim()}] [${info.level}] [${info.label}]: ${info.message}${info.stack ? `\n${info.stack}` : ''}`;
                })
            ),
            level: process.env.NODE_ENV === 'test' ? 'emerg' : 'debug',
            transports: [
                new transports.Console()
            ]
        });
    }
}

const log = LoggerUtil.getLogger('FileUtils');

// MavenUtil
class MavenUtil {
    static ID_REGEX = /([^@:]+):([^@:]+):?([^@:]+)?:?(?:([^@:]+))?:?(?:@{1}([^@:]+))?/;

    static mavenComponentsToIdentifier(group, artifact, version, classifier, extension) {
        return `${group}:${artifact}:${version}${classifier != null ? `:${classifier}` : ''}${extension != null ? `@${extension}` : ''}`;
    }

    static mavenComponentsToExtensionlessIdentifier(group, artifact, version, classifier) {
        return MavenUtil.mavenComponentsToIdentifier(group, artifact, version, classifier);
    }

    static mavenComponentsToVersionlessIdentifier(group, artifact, classifier) {
        return `${group}:${artifact}${classifier ? `:${classifier}` : ''}`;
    }

    static isMavenIdentifier(id) {
        return MavenUtil.ID_REGEX.test(id);
    }

    static getMavenComponents(id, extension = 'jar') {
        if (!MavenUtil.isMavenIdentifier(id)) {
            throw new Error('Id is not a maven identifier.');
        }

        const result = MavenUtil.ID_REGEX.exec(id);

        if (result != null) {
            return {
                group: result[1],
                artifact: result[2],
                version: result[3],
                classifier: result[4],
                extension: result[5] || extension
            };
        }

        throw new Error('Failed to process maven data.');
    }

    static mavenIdentifierAsPath(id, extension = 'jar') {
        const tmp = MavenUtil.getMavenComponents(id, extension);
        return MavenUtil.mavenComponentsAsPath(tmp.group, tmp.artifact, tmp.version, tmp.classifier, tmp.extension);
    }

    static mavenComponentsAsPath(group, artifact, version, classifier, extension = 'jar') {
        return `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}${classifier != null ? `-${classifier}` : ''}.${extension}`;
    }

    static mavenComponentsAsNormalizedPath(group, artifact, version, classifier, extension = 'jar') {
        return path.normalize(MavenUtil.mavenComponentsAsPath(group, artifact, version, classifier, extension));
    }
}

// MojangUtils
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
    if (rules == null) {
        return false;
    }
    for (const rule of rules) {
        if (rule.action != null && rule.os != null) {
            const osName = rule.os.name;
            const osMoj = getMojangOS();
            if (rule.action === 'allow') {
                return osName === osMoj;
            } else if (rule.action === 'disallow') {
                return osName !== osMoj;
            }
        }
    }
    return true;
}

function validateLibraryNatives(natives) {
    return natives == null ? true : Object.prototype.hasOwnProperty.call(natives, getMojangOS());
}

function isLibraryCompatible(rules, natives) {
    return rules == null ? validateLibraryNatives(natives) : validateLibraryRules(rules);
}

function mcVersionAtLeast(desired, actual) {
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
        } else if (parsedActual < parsedDesired) {
            return false;
        }
    }
    return true;
}

// DistroUtils
function getMainServer(servers) {
    const mainServer = servers.find(({ mainServer }) => mainServer);
    if (mainServer == null && servers.length > 0) {
        return servers[0];
    }
    return mainServer;
}

// FileUtils
function calculateHashByBuffer(buf, algo) {
    return crypto.createHash(algo).update(buf).digest('hex');
}

function calculateHash(filePath, algo) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash(algo);
        const input = fs.createReadStream(filePath);

        input.on('error', reject);
        input.on('data', chunk => hash.update(chunk));
        input.on('close', () => resolve(hash.digest('hex')));
    });
}

async function validateLocalFile(filePath, algo, hash) {
    try {
        await fs.promises.access(filePath);
    } catch (e) {
        return false;
    }

    if (hash == null) {
        return true;
    }

    try {
        return (await calculateHash(filePath, algo)) === hash;
    } catch (err) {
        log.error('Failed to calculate hash.', err);
    }
    return false;
}

async function validateFiles(files) {
    const invalidFiles = [];

    const q = fastq.promise(async (asset) => {
        if (!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
            invalidFiles.push(asset);
        }
    }, 15);

    await Promise.all(files.map(file => q.push(file)));

    return invalidFiles;
}

async function extractZip(zipPath, peek) {
    const zip = new StreamZip.async({
        file: zipPath,
        storeEntries: true
    });

    if (peek) {
        await peek(zip);
    }

    try {
        log.info(`Extracting ${zipPath}`);
        await zip.extract(null, path.dirname(zipPath));
        log.info(`Removing ${zipPath}`);
        await fs.promises.rm(zipPath, { recursive: true, force: true });
        log.info('Zip extraction complete.');

    } catch (err) {
        log.error('Zip extraction failed', err);
    } finally {
        await zip.close();
    }
}

async function extractTarGz(tarGzPath, peek) {
    return new Promise((resolve, reject) => {
        fs.createReadStream(tarGzPath)
            .on('error', err => log.error(err))
            .pipe(zlib.createGunzip())
            .on('error', err => log.error(err))
            .pipe(tar.extract(path.dirname(tarGzPath), {
                map: (header) => {
                    if (peek) {
                        peek(header);
                    }
                    return header;
                }
            }))
            .on('error', err => {
                log.error(err);
                reject(err);
            })
            .on('finish', () => {
                fs.unlink(tarGzPath, err => {
                    if (err) {
                        log.error(err);
                        reject();
                    } else {
                        resolve();
                    }
                });
            });
    });
}

function ensureEncodedPath(p) {
    return p; // Assuming path is already handled correctly in JS/Node
}

module.exports = {
    LoggerUtil,
    MavenUtil,
    getMojangOS,
    isLibraryCompatible,
    validateLibraryRules,
    mcVersionAtLeast,
    getMainServer,
    calculateHash,
    validateLocalFile,
    validateFiles,
    extractZip,
    extractTarGz,
    ensureEncodedPath
};
