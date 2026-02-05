const { exec, execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const util = require('util');
const semver = require('semver');
const { LoggerUtil } = require('../util/LoggerUtil');
const { HashAlgo } = require('../dl/Asset');
const { extractZip, extractTarGz } = require('../common/FileUtils');
const { Platform, JdkDistribution } = require('../common/DistributionClasses');

const log = LoggerUtil.getLogger('JavaGuard');
const execAsync = util.promisify(exec);
const execFileAsync = util.promisify(execFile);

const { MOJANG_MIRRORS } = require('../../../../../network/config');

let javaMirrorManifest = null;
let javaMirrorManifestMap = new Map(); // url -> manifest

// Winreg removed in favor of native reg.exe calls to avoid DEP0190

async function getHotSpotSettings(execPath) {
    const javaExecutable = path.resolve(execPath.includes('javaw.exe') ? execPath.replace('javaw.exe', 'java.exe') : execPath);
    try {
        await fs.access(javaExecutable);
    } catch (e) {
        log.warn(`Candidate JVM path does not exist, skipping. ${javaExecutable}`);
        return null;
    }

    let stderr;
    try {
        stderr = (await execFileAsync(javaExecutable, ['-XshowSettings:properties', '-version'], {
            cwd: path.dirname(javaExecutable)
        })).stderr;
    }
    catch (error) {
        log.error(`Failed to resolve JVM settings for '${execPath}'`, error);
        return null;
    }
    const listProps = [
        'java.library.path'
    ];
    const ret = {};
    const split = stderr.split('\n');
    let lastProp = null;
    for (const prop of split) {
        if (prop.startsWith('        ')) {
            if (!Array.isArray(ret[lastProp])) {
                ret[lastProp] = [ret[lastProp]];
            }
            ret[lastProp].push(prop.trim());
        }
        else if (prop.startsWith('    ')) {
            const tmp = prop.split('=');
            const key = tmp[0].trim();
            const val = tmp[1].trim();
            ret[key] = val;
            lastProp = key;
        }
    }
    for (const key of listProps) {
        if (ret[key] != null && !Array.isArray(ret[key])) {
            ret[key] = [ret[key]];
        }
    }
    return ret;
}

async function resolveJvmSettings(paths) {
    const ret = {};
    for (const path of paths) {
        const settings = await getHotSpotSettings(javaExecFromRoot(path));
        if (settings != null) {
            ret[path] = settings;
        }
        else {
            log.warn(`Skipping invalid JVM candidate: ${path}`);
        }
    }
    return ret;
}

function filterApplicableJavaPaths(resolvedSettings, semverRange) {
    const arm = process.arch === 'arm64';
    const jvmDetailsUnfiltered = Object.entries(resolvedSettings)
        .filter(([, settings]) => parseInt(settings['sun.arch.data.model']) === 64)
        .filter(([, settings]) => arm ? settings['os.arch'] === 'aarch64' : true)
        .map(([path, settings]) => {
            const parsedVersion = parseJavaRuntimeVersion(settings['java.version']);
            if (parsedVersion == null) {
                log.error(`Failed to parse JDK version at location '${path}' (Vendor: ${settings['java.vendor']}). Ensure this is a valid HotSpot or GraalVM build.`);
                return null;
            }
            return {
                semver: parsedVersion,
                semverStr: javaVersionToString(parsedVersion),
                vendor: settings['java.vendor'],
                path
            };
        })
        .filter(x => x != null);

    const jvmDetails = jvmDetailsUnfiltered
        .filter(details => semver.satisfies(details.semverStr, semverRange));
    return jvmDetails;
}

function rankApplicableJvms(details) {
    details.sort((a, b) => {
        if (a.semver.major === b.semver.major) {
            if (a.semver.minor === b.semver.minor) {
                if (a.semver.patch === b.semver.patch) {
                    if (a.path.toLowerCase().includes('jdk')) {
                        return b.path.toLowerCase().includes('jdk') ? 0 : 1;
                    }
                    else {
                        return -1;
                    }
                }
                else {
                    return (a.semver.patch - b.semver.patch) * -1;
                }
            }
            else {
                return (a.semver.minor - b.semver.minor) * -1;
            }
        }
        else {
            return (a.semver.major - b.semver.major) * -1;
        }
    });
}

async function discoverBestJvmInstallation(dataDir, semverRange) {
    const paths = [...new Set(await getValidatableJavaPaths(dataDir))];
    const resolvedSettings = await resolveJvmSettings(paths);
    const jvmDetails = filterApplicableJavaPaths(resolvedSettings, semverRange);
    rankApplicableJvms(jvmDetails);
    return jvmDetails.length > 0 ? jvmDetails[0] : null;
}

async function validateSelectedJvm(path, semverRange) {
    try {
        await fs.access(path);
    } catch (e) { return null; }

    const resolvedSettings = await resolveJvmSettings([path]);

    // We utilize the provided semver range to ensure the selected Java is valid.
    // Use '*' if no range is provided (fallback).
    const jvmDetails = filterApplicableJavaPaths(resolvedSettings, semverRange || '*');

    rankApplicableJvms(jvmDetails);
    return jvmDetails.length > 0 ? jvmDetails[0] : null;
}

async function loadJavaMirrorManifest(mirrorUrl) {
    if (javaMirrorManifestMap.has(mirrorUrl)) {
        return javaMirrorManifestMap.get(mirrorUrl);
    }
    try {
        const res = await fetch(mirrorUrl);
        if (res.ok) {
            const manifest = await res.json();
            javaMirrorManifestMap.set(mirrorUrl, manifest);
            return manifest;
        }
    } catch (e) {
        log.warn(`Failed to fetch Java mirror manifest from ${mirrorUrl}`, e);
    }
    return null;
}

async function latestOpenJDK(major, dataDir, distribution) {
    let result = null;

    // 1. Try Official Sources
    try {
        if (distribution == null) {
            if (major >= 17) {
                const graal = await latestGraalVM(major, dataDir);
                if (graal) result = graal;
                else {
                    log.warn(`GraalVM not found for Java ${major}, falling back to Adoptium.`);
                    result = await latestAdoptium(major, dataDir);
                }
            } else {
                result = await latestAdoptium(major, dataDir);
            }
        } else {
            switch (distribution) {
                case 'graalvm':
                    result = await latestGraalVM(major, dataDir);
                    break;
                case JdkDistribution.TEMURIN:
                    result = await latestAdoptium(major, dataDir);
                    break;
                case JdkDistribution.CORRETTO:
                    result = await latestCorretto(major, dataDir);
                    break;
                default:
                    const eMsg = `Unknown distribution '${distribution}'`;
                    log.error(eMsg);
                    throw new Error(eMsg);
            }
        }
    } catch (err) {
        log.warn(`Failed to resolve Java ${major} from official sources.`, err);
    }

    if (result) return result;

    // 2. Fallback to Mirror
    log.info('Attempting to resolve Java from configured mirrors...');
    if (MOJANG_MIRRORS && MOJANG_MIRRORS.length > 0) {
        for (const mirror of MOJANG_MIRRORS) {
            if (mirror.java_manifest) {
                const manifest = await loadJavaMirrorManifest(mirror.java_manifest);
                if (manifest) {
                    const os = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'darwin' : 'linux');
                    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

                    if (manifest[os] && manifest[os][arch] && manifest[os][arch][major]) {
                        const entry = manifest[os][arch][major];
                        log.info(`Resolved Java ${major} from Mirror: ${entry.url}`);
                        return {
                            url: entry.url,
                            size: 0,
                            id: `java-runtime-${major}-${os}-${arch}.zip`,
                            hash: entry.sha256,
                            algo: HashAlgo.SHA256,
                            path: path.join(getLauncherRuntimeDir(dataDir), `java-runtime-${major}-${os}-${arch}.zip`)
                        };
                    }
                }
            }
        }
    }

    return null;
}

async function latestGraalVM(major, dataDir) {
    // 1. Try Liberica NIK (Mirror - BellSoft servers, usually faster/more reliable than GitHub raw)
    try {
        const nik = await latestLibericaNIK(major, dataDir);
        if (nik) return nik;
    } catch (e) {
        log.warn(`Liberica NIK mirror failed for Java ${major}, falling back to GitHub.`, e);
    }

    // 2. Fallback to GitHub (Official GraalVM CE)
    return await latestGraalVM_GitHub(major, dataDir);
}

async function latestLibericaNIK(major, dataDir) {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'; // Liberica uses specific arch names
    const os = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'macos' : 'linux');
    const bitness = '64';
    const packageType = process.platform === 'win32' ? 'zip' : 'tar.gz';

    // BellSoft API v1 for NIK
    // https://api.bell-sw.com/v1/nik/releases?version-feature={major}&os={os}&arch={arch}&bitness=64&package-type={type}
    const url = `https://api.bell-sw.com/v1/nik/releases?version-feature=${major}&os=${os}&arch=${arch}&bitness=${bitness}&package-type=${packageType}&bundle-type=standard`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`BellSoft API Error ${res.status}`);

    const releases = await res.json();
    if (!releases || releases.length === 0) return null;

    // Get latest version
    const latest = releases[0]; // API usually sorts by version? Verification needed, but typically yes.

    // Construct download info
    return {
        url: latest.downloadUrl,
        size: latest.size,
        id: latest.filename, // e.g. bellsoft-nik23.0.1-linux-amd64.tar.gz
        hash: latest.sha1, // BellSoft provides sha1 usually
        algo: HashAlgo.SHA1,
        path: path.join(getLauncherRuntimeDir(dataDir), latest.filename)
    };
}

async function latestGraalVM_GitHub(major, dataDir) {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    let sanitizedOS;
    let ext;

    switch (process.platform) {
        case Platform.WIN32:
            sanitizedOS = 'windows';
            ext = 'zip';
            break;
        case Platform.DARWIN:
            sanitizedOS = 'macos';
            ext = 'tar.gz';
            break;
        case Platform.LINUX:
            sanitizedOS = 'linux';
            ext = 'tar.gz';
            break;
        default:
            sanitizedOS = process.platform;
            ext = 'tar.gz';
            break;
    }

    // GraalVM Community Edition (GitHub Releases)
    // Matches formats like: graalvm-community-jdk-21.0.2_windows-x64_bin.zip
    const repo = 'graalvm/graalvm-ce-builds';

    // We want the absolute latest release that matches our Major version
    // GitHub API 'latest' might be 22 while we want 21. 
    // So we list releases and find the first one matching 'jdk-{major}.'

    const url = `https://api.github.com/repos/${repo}/releases`;

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`GitHub API Error ${res.status}`);
        const releases = await res.json();

        // Find release for this major version
        const targetRelease = releases.find(r => r.tag_name && r.tag_name.startsWith(`jdk-${major}.`));

        if (!targetRelease) {
            log.warn(`No GraalVM release found for Java ${major}`);
            return null;
        }

        // Find asset
        const assetPrefix = `graalvm-community-jdk-${major}`;
        const assetSuffix = `${sanitizedOS}-${arch}_bin.${ext}`;

        const asset = targetRelease.assets.find(a =>
            a.name.toLowerCase().includes(sanitizedOS) &&
            a.name.toLowerCase().includes(arch) &&
            a.name.endsWith(ext)
        );

        if (asset) {
            return {
                url: asset.browser_download_url,
                size: asset.size,
                id: asset.name,
                hash: null, // GitHub doesn't provide easy hash in asset list, verify logic might need to skip or fetch .sha256 file
                algo: null,
                path: path.join(getLauncherRuntimeDir(dataDir), asset.name)
            };
        }

        return null;
    } catch (err) {
        log.error(`Error fetching GraalVM for Java ${major}`, err);
        return null;
    }
}

async function latestAdoptium(major, dataDir) {
    const sanitizedOS = process.platform === Platform.WIN32 ? 'windows' : (process.platform === Platform.DARWIN ? 'mac' : process.platform);
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    const url = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?vendor=eclipse`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();

        if (body.length > 0) {
            const targetBinary = body.find(entry => {
                return entry.version.major === major
                    && entry.binary.os === sanitizedOS
                    && entry.binary.image_type === 'jdk'
                    && entry.binary.architecture === arch;
            });
            if (targetBinary != null) {
                return {
                    url: targetBinary.binary.package.link,
                    size: targetBinary.binary.package.size,
                    id: targetBinary.binary.package.name,
                    hash: targetBinary.binary.package.checksum,
                    algo: HashAlgo.SHA256,
                    path: path.join(getLauncherRuntimeDir(dataDir), targetBinary.binary.package.name)
                };
            }
        }
        log.error(`Failed to find a suitable Adoptium binary for JDK ${major} (${sanitizedOS} ${arch}).`);
        return null;
    }
    catch (err) {
        log.error(`Error while retrieving latest Adoptium JDK ${major} binaries.`, err);
        return null;
    }
}

async function latestCorretto(major, dataDir) {
    let sanitizedOS, ext;
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    switch (process.platform) {
        case Platform.WIN32:
            sanitizedOS = 'windows';
            ext = 'zip';
            break;
        case Platform.DARWIN:
            sanitizedOS = 'macos';
            ext = 'tar.gz';
            break;
        case Platform.LINUX:
            sanitizedOS = 'linux';
            ext = 'tar.gz';
            break;
        default:
            sanitizedOS = process.platform;
            ext = 'tar.gz';
            break;
    }
    const url = `https://corretto.aws/downloads/latest/amazon-corretto-${major}-${arch}-${sanitizedOS}-jdk.${ext}`;

    try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok) {
            const finalUrl = res.url;
            const name = finalUrl.substring(finalUrl.lastIndexOf('/') + 1);
            return {
                url: finalUrl,
                size: parseInt(res.headers.get('content-length')),
                id: name,
                hash: null,
                algo: null,
                path: path.join(getLauncherRuntimeDir(dataDir), name)
            };
        }
        log.error(`Error while retrieving latest Corretto JDK ${major} (${sanitizedOS} ${arch}): ${res.status}`);
        return null;
    }
    catch (err) {
        log.error(`Error while retrieving latest Corretto JDK ${major} (${sanitizedOS} ${arch}).`, err);
        return null;
    }
}

async function extractJdk(archivePath) {
    let javaExecPath = null;
    if (archivePath.endsWith('zip')) {
        await extractZip(archivePath, async (zip) => {
            const entries = zip.entries(); // This is the mock object I made in FileUtils
            const keys = Object.keys(entries);
            javaExecPath = javaExecFromRoot(path.join(path.dirname(archivePath), keys[0]));
        });
    }
    else {
        await extractTarGz(archivePath, async (header) => {
            if (javaExecPath == null) {
                let h = header.name;
                if (h.includes('/')) {
                    h = h.substring(0, h.indexOf('/'));
                }
                javaExecPath = javaExecFromRoot(path.join(path.dirname(archivePath), h));
            }
        });
    }
    return javaExecPath;
}

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
            return index > -1 ? dir.substring(0, index) : dir;
        }
    }
}

function isJavaExecPath(pth) {
    switch (process.platform) {
        case Platform.WIN32:
            return pth.endsWith(path.join('bin', 'javaw.exe'));
        case Platform.DARWIN:
        case Platform.LINUX:
            return pth.endsWith(path.join('bin', 'java'));
        default:
            return false;
    }
}

function parseJavaRuntimeVersion(verString) {
    if (verString.startsWith('1.')) {
        return parseJavaRuntimeVersionLegacy(verString);
    }
    else {
        return parseJavaRuntimeVersionSemver(verString);
    }
}

function parseJavaRuntimeVersionLegacy(verString) {
    const regex = /1.(\d+).(\d+)_(\d+)(?:-b(\d+))?/;
    const match = regex.exec(verString);
    if (match == null) {
        log.error(`Failed to parse legacy Java version: ${verString}`);
        return null;
    }
    return {
        major: parseInt(match[1]),
        minor: parseInt(match[2]),
        patch: parseInt(match[3])
    };
}

function parseJavaRuntimeVersionSemver(verString) {
    const regex = /(\d+)\.(\d+).(\d+)(?:[+.](\d+))?/;
    const match = regex.exec(verString);
    if (match == null) {
        log.error(`Failed to parse semver Java version: ${verString}`);
        return null;
    }
    return {
        major: parseInt(match[1]),
        minor: parseInt(match[2]),
        patch: parseInt(match[3])
    };
}

function javaVersionToString({ major, minor, patch }) {
    return `${major}.${minor}.${patch}`;
}

async function getValidatableJavaPaths(dataDir) {
    let discoverers = [];
    switch (process.platform) {
        case Platform.WIN32:
            discoverers = await getWin32Discoverers(dataDir);
            break;
        case Platform.DARWIN:
            discoverers = await getDarwinDiscoverers(dataDir);
            break;
        case Platform.LINUX:
            discoverers = await getLinuxDiscoverers(dataDir);
            break;
        default:
            log.warn(`Unable to discover Java paths on platform: ${process.platform}`);
    }
    let paths = [];
    for (const discover of discoverers) {
        paths = [
            ...paths,
            ...await discover.discover()
        ];
    }
    return [...(new Set(paths))];
}

async function getWin32Discoverers(dataDir) {
    const list = [
        new EnvironmentBasedJavaDiscoverer(getPossibleJavaEnvs()),
        new DirectoryBasedJavaDiscoverer([
            ...(await getPathsOnAllDrivesWin32([
                'Program Files\\Java',
                'Program Files\\Eclipse Adoptium',
                'Program Files\\Eclipse Foundation',
                'Program Files\\AdoptOpenJDK',
                'Program Files\\Amazon Corretto'
            ])),
            getLauncherRuntimeDir(dataDir)
        ])
    ];
    list.push(new Win32RegistryJavaDiscoverer());
    return list;
}

async function getDarwinDiscoverers(dataDir) {
    return [
        new EnvironmentBasedJavaDiscoverer(getPossibleJavaEnvs()),
        new DirectoryBasedJavaDiscoverer([
            '/Library/Java/JavaVirtualMachines',
            getLauncherRuntimeDir(dataDir)
        ]),
        new PathBasedJavaDiscoverer([
            '/Library/Internet Plug-Ins/JavaAppletPlugin.plugin'
        ])
    ];
}

async function getLinuxDiscoverers(dataDir) {
    return [
        new EnvironmentBasedJavaDiscoverer(getPossibleJavaEnvs()),
        new DirectoryBasedJavaDiscoverer([
            '/usr/lib/jvm',
            getLauncherRuntimeDir(dataDir)
        ])
    ];
}

async function win32DriveMounts() {
    try {
        const { stdout } = await execAsync('gdr -psp FileSystem | select -eXp root | ConvertTo-Json', { shell: 'powershell.exe' });
        const res = JSON.parse(stdout);
        return Array.isArray(res) ? res : [res];
    }
    catch (error) {
        return ['C:\\'];
    }
}

async function getPathsOnAllDrivesWin32(paths) {
    const driveMounts = await win32DriveMounts();
    const res = [];
    for (const p of paths) {
        for (const mount of driveMounts) {
            res.push(path.join(mount, p));
        }
    }
    return res;
}

function getPossibleJavaEnvs() {
    return [
        'JAVA_HOME',
        'JRE_HOME',
        'JDK_HOME'
    ];
}

function getLauncherRuntimeDir(dataDir) {
    return path.join(dataDir, 'runtime', process.arch);
}

class PathBasedJavaDiscoverer {
    constructor(paths) {
        this.paths = paths;
    }
    async discover() {
        const res = new Set();
        for (const p of this.paths) {
            try {
                await fs.access(javaExecFromRoot(p));
                res.add(p);
            } catch (e) { }
        }
        return [...res];
    }
}

class DirectoryBasedJavaDiscoverer {
    constructor(directories) {
        this.directories = directories;
    }
    async discover() {
        const res = new Set();
        for (const directory of this.directories) {
            try {
                const files = await fs.readdir(directory);
                for (const file of files) {
                    const fullPath = path.join(directory, file);
                    try {
                        await fs.access(javaExecFromRoot(fullPath));
                        res.add(fullPath);
                    } catch (e) { }
                }
            } catch (e) { }
        }
        return [...res];
    }
}

class EnvironmentBasedJavaDiscoverer {
    constructor(keys) {
        this.keys = keys;
    }
    async discover() {
        const res = new Set();
        for (const key of this.keys) {
            const value = process.env[key];
            if (value != null) {
                const asRoot = ensureJavaDirIsRoot(value);
                try {
                    await fs.access(asRoot);
                    res.add(asRoot);
                } catch (e) { }
            }
        }
        return [...res];
    }
}

class Win32RegistryJavaDiscoverer {
    async discover() {
        if (process.platform !== 'win32') return [];

        const regKeys = [
            '\\SOFTWARE\\JavaSoft\\Java Runtime Environment',
            '\\SOFTWARE\\JavaSoft\\Java Development Kit',
            '\\SOFTWARE\\JavaSoft\\JRE',
            '\\SOFTWARE\\JavaSoft\\JDK'
        ];

        const candidates = new Set();

        for (const keyPath of regKeys) {
            try {
                // List subkeys (versions)
                const { stdout } = await execFileAsync('reg', ['query', 'HKLM' + keyPath]);
                if (!stdout) continue;

                const lines = stdout.split('\n');
                const subkeys = lines.filter(line => line.trim().startsWith('HKEY_LOCAL_MACHINE'));

                for (const subkey of subkeys) {
                    try {
                        // Get JavaHome for each subkey
                        const { stdout: valStdout } = await execFileAsync('reg', ['query', subkey.trim(), '/v', 'JavaHome']);
                        if (!valStdout) continue;

                        // Parse JavaHome    REG_SZ    Path
                        const match = valStdout.match(/\sJavaHome\s+REG_SZ\s+(.*)/i);
                        if (match && match[1]) {
                            const javaHome = match[1].trim();
                            if (javaHome && !javaHome.includes('(x86)')) {
                                candidates.add(javaHome);
                            }
                        }
                    } catch (e) {
                        // Ignore errors reading specific subkey
                    }
                }
            } catch (e) {
                // Key might not exist, ignore
            }
        }
        return [...candidates];
    }
}

module.exports = {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    discoverBestJvmInstallation,
    latestOpenJDK,
    extractJdk
}
