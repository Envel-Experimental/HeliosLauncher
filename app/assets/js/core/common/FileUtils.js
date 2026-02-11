const fs = require('fs/promises')
const { createReadStream } = require('fs')
const crypto = require('crypto')
const path = require('path')
const { exec } = require('child_process')
const util = require('util')
const execAsync = util.promisify(exec)

const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024 // 50MB

function sanitizePsPath(p) {
    return p.replace(/'/g, "''")
}

async function validateLocalFile(filePath, algo, hash) {
    if (!hash) return true; // No hash to check
    try {
        await fs.access(filePath);
    } catch (e) {
        return false;
    }

    return new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        // Normalize algorithm name
        const algorithm = algo.toLowerCase().replace('-', '');
        const hashStream = crypto.createHash(algorithm);

        stream.on('error', err => {
            // File read error
            resolve(false);
        });

        hashStream.on('error', err => {
            // Algorithm error
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

// Worker removed in favor of system tools


async function extractZip(archivePath, destDir, onEntry) {
    // Support legacy signature: extractZip(archivePath, onEntry)
    if (typeof destDir === 'function') {
        onEntry = destDir;
        destDir = null;
    }
    if (!destDir) destDir = path.dirname(archivePath);

    const isWin = process.platform === 'win32';

    // 1. Extraction
    if (isWin) {
        // Try tar first (Windows 10+), fallback to PowerShell
        try {
            await execAsync(`tar -xf "${archivePath}" -C "${destDir}"`, { maxBuffer: DEFAULT_MAX_BUFFER });
        } catch (e) {
            // Fallback to PowerShell for older Windows
            const psCmd = `Expand-Archive -LiteralPath '${sanitizePsPath(archivePath)}' -DestinationPath '${sanitizePsPath(destDir)}' -Force`;
            await execAsync(`powershell -NoProfile -Command "${psCmd}"`, { maxBuffer: DEFAULT_MAX_BUFFER });
        }
    } else {
        await execAsync(`unzip -o "${archivePath}" -d "${destDir}"`, { maxBuffer: DEFAULT_MAX_BUFFER });
    }

    // 2. Mock 'onEntry' for JavaGuard compatibility
    // JavaGuard needs to know the root folder name.
    // We can list the zip content to find it.
    if (onEntry) {
        let entries = [];
        try {
            if (isWin) {
                // tar -tf works on Win10+
                // PowerShell fallback for listing:
                // $zip = [System.IO.Compression.ZipFile]::OpenRead("path"); $zip.Entries | Select -ExpandProperty FullName
                try {
                    const { stdout } = await execAsync(`tar -tf "${archivePath}"`, { maxBuffer: DEFAULT_MAX_BUFFER });
                    entries = stdout.split(/\r?\n/).filter(l => l.trim().length > 0);
                } catch (e) {
                    // PowerShell fallback
                    const psCmd = `
                        Add-Type -AssemblyName System.IO.Compression.FileSystem;
                        [System.IO.Compression.ZipFile]::OpenRead('${sanitizePsPath(archivePath)}').Entries | Select-Object -ExpandProperty FullName
                     `;
                    const { stdout } = await execAsync(`powershell -NoProfile -Command "${psCmd.replace(/\n/g, '')}"`, { maxBuffer: DEFAULT_MAX_BUFFER });
                    entries = stdout.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
                }
            } else {
                const { stdout } = await execAsync(`unzip -Z1 "${archivePath}"`, { maxBuffer: DEFAULT_MAX_BUFFER });
                entries = stdout.split('\n').filter(l => l.trim().length > 0);
            }
        } catch (e) {
            console.warn('[FileUtils] Failed to list zip entries, JavaGuard detection might fail.', e);
        }

        const entriesObj = {};
        entries.forEach(name => {
            // Normalize slashes
            const n = name.replace(/\\/g, '/');
            if (n) entriesObj[n] = { entryName: n };
        });

        await onEntry({ entries: () => entriesObj });
    }
}

async function extractTarGz(archivePath, onEntry) {
    const destDir = path.dirname(archivePath);
    await execAsync(`tar -xzf "${archivePath}" -C "${destDir}"`, { maxBuffer: DEFAULT_MAX_BUFFER });

    if (onEntry) {
        const { stdout } = await execAsync(`tar -tf "${archivePath}"`, { maxBuffer: DEFAULT_MAX_BUFFER });
        const lines = stdout.split('\n').filter(l => l.trim().length > 0);
        await onEntry({ name: lines[0] });
    }
}

async function readFileFromZip(archivePath, entryName) {
    const isWin = process.platform === 'win32';
    const entryPath = entryName.replace(/\\/g, '/'); // Zip standard is forward slashes

    if (isWin) {
        try {
            // tar -xOf "archive" "member"
            // -O extracts to stdout. We set encoding to null to get a Buffer.
            const { stdout } = await execAsync(`tar -xOf "${archivePath}" "${entryPath}"`, { encoding: null, maxBuffer: DEFAULT_MAX_BUFFER });
            return stdout;
        } catch (e) {
            // PowerShell Fallback
            // Note: This reads text. For binary, we might need encoding adjustments, but version.json is text.
            const psCmd = `
                Add-Type -AssemblyName System.IO.Compression.FileSystem;
                $zip = [System.IO.Compression.ZipFile]::OpenRead('${sanitizePsPath(archivePath)}');
                $entry = $zip.GetEntry('${sanitizePsPath(entryPath)}');
                if ($entry) {
                    $reader = [System.IO.StreamReader]::new($entry.Open());
                    $reader.ReadToEnd();
                }
            `;
            const { stdout } = await execAsync(`powershell -NoProfile -Command "${psCmd.replace(/\n/g, '')}"`, { maxBuffer: DEFAULT_MAX_BUFFER });
            return stdout;
        }
    } else {
        // unzip -p "archive" "member"
        const { stdout } = await execAsync(`unzip -p "${archivePath}" "${entryPath}"`, { encoding: null, maxBuffer: DEFAULT_MAX_BUFFER });
        return stdout;
    }
}

module.exports = { validateLocalFile, safeEnsureDir, getLibraryDir, getVersionDir, getVersionJsonPath, getVersionJarPath, calculateHashByBuffer, extractZip, extractTarGz, readFileFromZip }
