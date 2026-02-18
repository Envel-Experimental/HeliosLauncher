const fs = require('fs/promises')
const { createReadStream } = require('fs')
const crypto = require('crypto')
const path = require('path')
const { spawn } = require('child_process')

/**
 * Execute a command using spawn.
 * @param {string} cmd Command to run
 * @param {string[]} args Arguments
 * @param {object} options Spawn options
 * @returns {Promise<{stdout: Buffer}>}
 */
async function runCommand(cmd, args, options = {}) {
    return new Promise((resolve, reject) => {
        const process = spawn(cmd, args, {
            ...options,
            shell: false
        });

        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);

        process.stdout.on('data', (data) => { stdout = Buffer.concat([stdout, data]); });
        process.stderr.on('data', (data) => { stderr = Buffer.concat([stderr, data]); });

        process.on('close', (code) => {
            if (code === 0) resolve({ stdout });
            else reject(new Error(`Command ${cmd} failed with code ${code}: ${stderr.toString()}`));
        });

        process.on('error', (err) => {
            reject(err)
        })
    });
}

async function validateLocalFile(filePath, algo, hash, expectedSize) {
    if (hash == null) {
        console.warn(`[Security] No hash provided for ${filePath}. Skipping validation.`);
        return true;
    }

    try {
        const stat = await fs.stat(filePath);
        if (expectedSize && stat.size !== expectedSize) {
            // console.debug(`[FileUtils] Size mismatch for ${path.basename(filePath)}: Expected ${expectedSize}, Got ${stat.size}`);
            return false;
        }
    } catch (e) {
        return false;
    }

    return new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        const algorithm = algo.toLowerCase().replace('-', '');
        const hashStream = crypto.createHash(algorithm);

        stream.on('error', err => {
            resolve(false);
        });

        hashStream.on('error', err => {
            resolve(false);
        });

        stream.pipe(hashStream).on('finish', () => {
            const computedHash = hashStream.read().toString('hex');
            const isValid = computedHash === hash.toLowerCase();
            if (!isValid) {
                console.warn(`[FileUtils] Validation Failed for ${filePath}\n  Expected: ${hash}\n  Actual:   ${computedHash}`);
            }
            resolve(isValid);
        });
    });
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
    const algorithm = algo.toLowerCase().replace('-', '');
    return crypto.createHash(algorithm).update(buffer).digest('hex');
}

async function extractZip(archivePath, destDir, onEntry) {
    // Support legacy signature: extractZip(archivePath, onEntry)
    if (typeof destDir === 'function') {
        onEntry = destDir;
        destDir = null;
    }
    if (!destDir) destDir = path.dirname(archivePath);

    const isWin = process.platform === 'win32';

    if (isWin) {
        try {
            await runCommand('tar', ['-xf', archivePath, '-C', destDir]);
        } catch (e) {
            const psArgs = ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destDir}' -Force`];
            await runCommand('powershell', psArgs);
        }
    } else {
        await runCommand('unzip', ['-o', archivePath, '-d', destDir]);
    }

    // Mock 'onEntry' for JavaGuard compatibility
    if (onEntry) {
        let entries = [];
        try {
            if (isWin) {
                try {
                    const { stdout } = await runCommand('tar', ['-tf', archivePath]);
                    entries = stdout.toString().split(/\r?\n/).filter(l => l.trim().length > 0);
                } catch (e) {
                    const psCmd = `
                        Add-Type -AssemblyName System.IO.Compression.FileSystem;
                        [System.IO.Compression.ZipFile]::OpenRead('${archivePath}').Entries | Select-Object -ExpandProperty FullName
                     `;
                    const { stdout } = await runCommand('powershell', ['-NoProfile', '-Command', psCmd]);
                    entries = stdout.toString().split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
                }
            } else {
                const { stdout } = await runCommand('unzip', ['-Z1', archivePath]);
                entries = stdout.toString().split('\n').filter(l => l.trim().length > 0);
            }
        } catch (e) {
            console.warn('[FileUtils] Failed to list zip entries, JavaGuard detection might fail.', e);
        }

        const entriesObj = {};
        entries.forEach(name => {
            const n = name.replace(/\\/g, '/');
            if (n) entriesObj[n] = { entryName: n };
        });

        await onEntry({ entries: () => entriesObj });
    }
}

async function extractTarGz(archivePath, onEntry) {
    const destDir = path.dirname(archivePath);
    await runCommand('tar', ['-xzf', archivePath, '-C', destDir]);

    if (onEntry) {
        const { stdout } = await runCommand('tar', ['-tf', archivePath]);
        const lines = stdout.toString().split('\n').filter(l => l.trim().length > 0);
        await onEntry({ name: lines[0] });
    }
}

async function readFileFromZip(archivePath, entryName) {
    const isWin = process.platform === 'win32';
    const entryPath = entryName.replace(/\\/g, '/');

    if (isWin) {
        try {
            const { stdout } = await runCommand('tar', ['-xOf', archivePath, entryPath]);
            return stdout;
        } catch (e) {
            const psCmd = `
                Add-Type -AssemblyName System.IO.Compression.FileSystem;
                $zip = [System.IO.Compression.ZipFile]::OpenRead('${archivePath}');
                $entry = $zip.GetEntry('${entryPath}');
                if ($entry) {
                    $reader = [System.IO.StreamReader]::new($entry.Open());
                    $reader.ReadToEnd();
                }
            `;
            const { stdout } = await runCommand('powershell', ['-NoProfile', '-Command', psCmd]);
            return typeof stdout === 'string' ? Buffer.from(stdout, 'utf-8') : stdout;
        }
    } else {
        const { stdout } = await runCommand('unzip', ['-p', archivePath, entryPath]);
        return stdout;
    }
}

module.exports = { validateLocalFile, safeEnsureDir, getLibraryDir, getVersionDir, getVersionJsonPath, getVersionJarPath, calculateHashByBuffer, extractZip, extractTarGz, readFileFromZip }
