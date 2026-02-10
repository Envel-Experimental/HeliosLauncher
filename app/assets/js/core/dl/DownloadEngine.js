const { LoggerUtil } = require('../util/LoggerUtil');
const { validateLocalFile, safeEnsureDir } = require('../common/FileUtils');
const { ensureDecodedPath, sleep } = require('../util/NodeUtil');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');
const P2PEngine = require('../../../../../network/P2PEngine');
const RaceManager = require('../../../../../network/RaceManager');
const { MAX_PARALLEL_DOWNLOADS } = require('../../../../../network/constants');
const ConfigManager = require('../../configmanager');
const isDev = require('../../isdev');
const MirrorManager = require('../../../../../network/MirrorManager');

const log = LoggerUtil.getLogger('DownloadEngine');

// Cleaning Task State
let lastCleanup = 0;
const CLEANUP_INTERVAL = 1000 * 60 * 60; // Run at most once per hour

async function cleanupStaleTempFiles() {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL) return;
    lastCleanup = now;

    log.info('[Cleanup] Starting stale .tmp file cleanup...');
    const MAX_AGE = 24 * 60 * 60 * 1000; // 24 Hours

    const scanAndClean = async (dir) => {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    // Limit recursion to relevant folders to avoid scanning the entire disk
                    // We only store downloads in 'assets', 'libraries', 'natives', 'objects' or sub-dirs like '00'-'ff'
                    if (['assets', 'libraries', 'natives', 'objects', 'common', 'minecraft'].includes(entry.name) || /^[0-9a-f]{2}$/.test(entry.name)) {
                        await scanAndClean(fullPath);
                    }
                } else if (entry.isFile() && entry.name.endsWith('.tmp')) {
                    try {
                        const stats = await fs.stat(fullPath);
                        if (now - stats.mtimeMs > MAX_AGE) {
                            await fs.unlink(fullPath);
                            log.debug(`[Cleanup] Deleted stale file: ${fullPath}`);
                        }
                    } catch (e) { }
                }
            }
        } catch (e) { }
    };

    try {
        const dataDir = ConfigManager.getDataDirectory().trim();
        const commonDir = ConfigManager.getCommonDirectory().trim();

        await scanAndClean(dataDir);
        if (commonDir !== dataDir) await scanAndClean(commonDir);
    } catch (e) {
        log.warn('[Cleanup] Cleanup failed:', e);
    }
}

async function downloadQueue(assets, onProgress) {
    // Run cleanup in background (don't await)
    cleanupStaleTempFiles().catch(e => log.error('Cleanup Error:', e));

    P2PEngine.start();
    const limit = MAX_PARALLEL_DOWNLOADS;
    const receivedTotals = assets.reduce((acc, a) => ({ ...acc, [a.id]: 0 }), {});
    let receivedGlobal = 0;

    let activeDownloads = 0;
    const deferredQueue = [];

    const runDownload = async (asset, forceHTTP = false, instantDefer = false) => {
        const onEachProgress = (transferred) => {
            receivedGlobal += (transferred - receivedTotals[asset.id]);
            receivedTotals[asset.id] = transferred;
            if (onProgress) onProgress(receivedGlobal);
        };
        await downloadFile(asset, onEachProgress, forceHTTP, instantDefer);
    };

    let queue = [...assets];

    const worker = async (forceHTTP = false, instantDefer = false) => {
        while (queue.length > 0) {
            // Dynamic Throttling
            const currentMax = P2PEngine.getOptimalConcurrency(limit);
            if (activeDownloads >= currentMax) {
                await sleep(100);
                continue;
            }

            const asset = queue.shift();
            if (!asset) break;

            activeDownloads++;
            try {
                await runDownload(asset, forceHTTP, instantDefer);
            } catch (err) {
                if (!forceHTTP) {
                    if (isDev) log.debug(`[DownloadEngine] Deferring failed file: ${asset.id} (${err.message}). Will retry at the end.`);
                    deferredQueue.push(asset);
                } else {
                    // In final stand, if it fails again, we must collect it to throw later
                    // Attach history to asset for reporting
                    if (err.history) {
                        asset.history = err.history;
                    } else {
                        asset.history = [{ error: err.message, attempt: 'Final' }];
                    }
                    deferredQueue.push(asset);
                }
            } finally {
                activeDownloads--;
            }
        }
    };

    // 1. Main Pass (Fast pass: try only once and defer failures)
    const workers = [];
    for (let i = 0; i < limit; i++) workers.push(worker(false, true));
    await Promise.all(workers);

    // 2. Final Stand Pass (Retry deferred files with Force HTTP)
    if (deferredQueue.length > 0) {
        log.warn(`[DownloadEngine] Attempting "Final Stand" for ${deferredQueue.length} deferred files (P2P Disabled)...`);
        queue = [...deferredQueue];
        deferredQueue.length = 0; // Clear it to reuse for last check

        // Use fewer workers for final pass to avoid congestion
        const finalWorkers = [];
        for (let i = 0; i < 4; i++) finalWorkers.push(worker(true));
        await Promise.all(finalWorkers);
    }

    // 3. Last Check
    if (deferredQueue.length > 0) {
        const names = deferredQueue.map(a => a.id).join(', ');
        const criticalError = new Error(`Critical failure: Failed to download ${deferredQueue.length} files even after deferral: ${names}`);
        criticalError.failedFiles = deferredQueue.map(a => ({
            id: a.id,
            url: a.url,
            history: a.history || []
        }));
        throw criticalError;
    }

    return receivedTotals;
}

async function downloadFile(asset, onProgress, forceHTTP = false, instantDefer = false) {
    if (!asset || !asset.path) {
        throw new Error('Asset or asset path is null or undefined.');
    }
    const { url, path: assetPath, algo, hash } = asset;
    const decodedPath = ensureDecodedPath(assetPath);
    const CONFIG_EXTENSIONS = ['.txt', '.json', '.yml', '.yaml', '.dat'];

    // Initial check (Optimistic)
    try {
        await fs.access(decodedPath);

        // Mutable File Handling: Skip validation for configs and ANYTHING in instances
        const isInstanceFile = decodedPath.replace(/\\/g, '/').includes('/instances/');
        const isConfig = CONFIG_EXTENSIONS.includes(path.extname(decodedPath));

        if (isConfig || isInstanceFile) {
            log.debug(`Skipping validation/download of mutable file: ${decodedPath}`);
            if (onProgress) onProgress(asset.size);
            return;
        }

        if (await validateLocalFile(decodedPath, algo, hash)) {
            log.debug(`File already exists and is valid: ${decodedPath}`);
            if (onProgress) onProgress(asset.size); // Account for skipping
            return;
        }
    } catch (e) { }

    await safeEnsureDir(path.dirname(decodedPath));

    let lastError = null;
    const attemptHistory = [];

    // Retry Loop (Resilience)
    const candidates = [asset.url, ...(asset.fallbackUrls || [])].filter(Boolean);

    for (let attempt = 0; attempt < 5; attempt++) {
        // RESUMPTION LOGIC
        let startOffset = 0
        const tempPath = decodedPath + '.tmp';

        try {
            // Check if we have a partial file to resume
            if (fsSync.existsSync(tempPath)) {
                // Only resume if it's NOT the first attempt (fresh start) OR if we are explicitly retrying
                // Actually, if temp exists, we should probably try to resume unless it's corrupt.
                const stat = fsSync.statSync(tempPath)
                if (stat.size > 0 && stat.size < asset.size) {
                    startOffset = stat.size
                    if (isDev) log.debug(`[DownloadEngine] Resuming ${asset.id} from offset ${startOffset} / ${asset.size}`)
                } else if (stat.size >= asset.size) {
                    // It's already full? Validation will catch it, or it's corrupt. Let's reset just in case if we are here.
                    startOffset = 0
                    await fs.unlink(tempPath)
                }
            }
        } catch (e) {
            startOffset = 0
        }

        const candidate = candidates[attempt % candidates.length];
        const currentUrl = typeof candidate === 'string' ? candidate : candidate.url;
        const currentHash = typeof candidate === 'object' && candidate.hash ? candidate.hash : hash;

        // Start Timing for MirrorManager
        const downloadStartTime = Date.now();

        // Strict Blocking: If P2P Only Mode is enabled, BLOCK all official Mojang/Minecraft domains
        // But ALLOW mirrors (which are not mojang.com/minecraft.net)
        if (ConfigManager.getP2POnlyMode()) {
            try {
                const urlObj = new URL(currentUrl);
                if (urlObj.hostname.endsWith('mojang.com') || urlObj.hostname.endsWith('minecraft.net')) {
                    // log.debug(`[DownloadEngine] Blocking official URL in P2P Only Mode: ${currentUrl}`);
                    continue;
                }
            } catch (e) { }
        }

        try {
            if (attempt > 0) {
                await sleep(attempt * 1000);
                if (candidates.length > 1 && attempt % candidates.length !== 0) {
                    if (isDev) log.debug(`[DownloadEngine] Primary failed, trying fallback: ${currentUrl}`);
                }
            }

            // RaceManager Strategy
            // Construct headers
            const headers = new Headers();
            if (asset.size) headers.append('X-Expected-Size', asset.size.toString());
            if (startOffset > 0) headers.append('X-Start-Offset', startOffset.toString()); // Hint for P2P/RaceManager
            if (assetPath) {
                const dataDir = ConfigManager.getDataDirectory().trim();
                const relPath = path.relative(dataDir, assetPath).replace(/\\/g, '/');
                headers.append('X-File-Path', relPath);
            }
            if (asset.id) headers.append('X-File-Id', asset.id);

            // Force HTTP after 2 failed attempts or if explicitly requested (deferral)
            // But NOT if we are in P2P Only Mode (where HTTP is blocked anyway)
            if ((attempt >= 2 || forceHTTP) && !ConfigManager.getP2POnlyMode()) {
                headers.append('X-Skip-P2P', 'true');
            }

            // SMART DEFERRAL: If we are in "Only P2P" mode and have no peers yet, 
            // don't waste time waiting for timeouts - defer to the end of the queue.
            if (instantDefer && P2PEngine.peers.length === 0 && !forceHTTP) {
                // Let the first few files try (to trigger discovery), but defer the rest
                if (Math.random() > 0.1) {
                    throw new Error('DEFER: No peers available (Waiting for discovery)');
                }
            }

            // Use RaceManager
            const req = new Request(currentUrl, { headers });

            const response = await RaceManager.handle(req);

            if (!response.ok) throw new Error(`RaceManager failed: ${response.status}`);

            const tempPath = decodedPath + '.tmp';
            const fileStream = fsSync.createWriteStream(tempPath, { flags: startOffset > 0 ? 'a' : 'w' });

            // Progress tracking wrapper
            let loaded = startOffset;
            let lastProgressTime = 0;
            const total = asset.size || 0;

            // Direct Node Stream (P2P / RaceManager optimized)
            if (response.p2pStream) {
                const progressStream = new Transform({
                    transform(chunk, encoding, callback) {
                        loaded += chunk.length;
                        const now = Date.now();
                        if (onProgress && (now - lastProgressTime >= 100 || loaded === total)) {
                            onProgress(loaded);
                            lastProgressTime = now;
                        }
                        this.push(chunk);
                        callback();
                    }
                });
                await pipeline(response.p2pStream, progressStream, fileStream);
            }
            // Web Response Body (Standard HTTP)
            else if (response.body) {
                const reader = response.body.getReader();
                const nodeStream = new Readable({
                    async read() {
                        try {
                            const { done, value } = await reader.read();
                            if (done) {
                                this.push(null);
                            } else {
                                loaded += value.length;
                                const now = Date.now();
                                if (onProgress && (now - lastProgressTime >= 100 || loaded === total)) {
                                    onProgress(loaded);
                                    lastProgressTime = now;
                                }
                                this.push(Buffer.from(value));
                            }
                        } catch (e) {
                            this.destroy(e);
                        }
                    }
                });

                await pipeline(nodeStream, fileStream);
            } else {
                throw new Error('No body in response');
            }

            // Validate Atomic Write (RCE Guard)
            if (await validateLocalFile(tempPath, algo, currentHash)) {
                // Success! Atomic rename to final path
                await fs.rename(tempPath, decodedPath);

                // Report Success to MirrorManager
                MirrorManager.reportSuccess(currentUrl, Date.now() - downloadStartTime, loaded);
                return;
            } else {
                if (isDev) console.error(`[DownloadEngine] Validation failed for ${asset.id}. File size: ${loaded} / ${total}`)

                // DEBUG: Inspect contents and delete temp
                try {
                    const content = await fs.readFile(tempPath);
                    const preview = content.slice(0, 100).toString('utf-8');
                    console.error(`[DownloadEngine] Failed File Content Preview (First 100 bytes): ${preview}`);
                    await fs.unlink(tempPath);
                } catch (e) { }

                const validationError = new Error('Validation failed');
                attemptHistory.push({
                    attempt: attempt + 1,
                    url: currentUrl,
                    method: headers.has('X-Skip-P2P') ? 'HTTP' : 'Race(P2P+HTTP)',
                    error: `Hash Mismatch (Got ${loaded} bytes)`
                });
                throw validationError;
            }

        } catch (err) {
            lastError = err;

            // On failure, do NOT delete .tmp if it's a P2P error (we might resume later)
            // But if it's a validation error (hash mismatch on full file), we MUST delete it.
            const isValidationError = err.message === 'Validation failed'

            if (isValidationError) {
                try { await fs.unlink(decodedPath + '.tmp') } catch (e) { }
            }

            // Record failure if not already recorded (Validation failed adds its own)
            if (err.message !== 'Validation failed') {
                attemptHistory.push({
                    attempt: attempt + 1,
                    url: currentUrl,
                    method: 'Unknown', // Headers scope is limited, simplifying for safety or need to recalc
                    error: err.message
                });

                // Report Failure to MirrorManager (network or validation error)
                MirrorManager.reportFailure(currentUrl);
            }

            if (instantDefer) {
                // Return immediate failure to defer the file
                const deferError = new Error(err.message);
                deferError.history = attemptHistory;
                throw deferError;
            }
            // Continue to next attempt
        }
    }

    // If we're here, all retries failed
    // If we're here, all retries failed
    log.error(`Failed to download ${asset.id} after 5 attempts: ${lastError ? lastError.message : 'Unknown error'}`);
    const finalError = lastError || new Error('Download failed after multiple attempts');
    finalError.history = attemptHistory;
    throw finalError;
}

let activeHttpRequests = 0;

module.exports = { downloadQueue, downloadFile }
