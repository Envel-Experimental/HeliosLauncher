const fs = require('fs/promises')
const crypto = require('crypto')
const path = require('path')
const AdmZip = require('adm-zip')
const { exec } = require('child_process')
const util = require('util')
const execAsync = util.promisify(exec)

async function validateLocalFile(filePath, algo, hash) {
    try {
        const fileBuffer = await fs.readFile(filePath)
        const computedHash = crypto.createHash(algo).update(fileBuffer).digest('hex')
        return computedHash === hash
    } catch (e) {
        return false
    }
}

async function safeEnsureDir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true })
}

function getLibraryDir(commonDir) {
    return path.join(commonDir, 'libraries');
}

function getVersionDir(commonDir) {
    return path.join(commonDir, 'versions');
}

function getVersionJsonPath(commonDir, version) {
    return path.join(getVersionDir(commonDir), version, `${version}.json`);
}

function getVersionJarPath(commonDir, version) {
    return path.join(getVersionDir(commonDir), version, `${version}.jar`);
}

function calculateHashByBuffer(buffer, algo) {
    return crypto.createHash(algo).update(buffer).digest('hex');
}

async function extractZip(archivePath, onEntry) {
    const zip = new AdmZip(archivePath);
    const entries = zip.getEntries();

    // Mocking the zip interface expected by JavaGuard (onEntry)
    // JavaGuard uses `await zip.entries()` then object keys.
    // Here we can just extract all.
    zip.extractAllTo(path.dirname(archivePath), true);

    if(onEntry) {
        // JavaGuard expects an object where keys are entry names.
        const entriesObj = {};
        entries.forEach(e => entriesObj[e.entryName] = e);
        // We pass a mock object with entries method
        await onEntry({ entries: () => entriesObj });
    }
}

async function extractTarGz(archivePath, onEntry) {
    const destDir = path.dirname(archivePath);
    await execAsync(`tar -xzf "${archivePath}" -C "${destDir}"`);

    if(onEntry) {
        // We need to list files to simulate onEntry
        const files = await fs.readdir(destDir);
        // This is a bit weak but enough for JavaGuard to find the root folder if it's the only new thing.
        // But JavaGuard uses the entry name from the archive.
        // We can run `tar -tf` to list files.
        const { stdout } = await execAsync(`tar -tf "${archivePath}"`);
        const lines = stdout.split('\n');
        const entriesObj = {};
        lines.forEach(l => { if(l) entriesObj[l] = true; });

        await onEntry({ name: lines[0] }); // JavaGuard passes header which has .name
    }
}

module.exports = { validateLocalFile, safeEnsureDir, getLibraryDir, getVersionDir, getVersionJsonPath, getVersionJarPath, calculateHashByBuffer, extractZip, extractTarGz }
