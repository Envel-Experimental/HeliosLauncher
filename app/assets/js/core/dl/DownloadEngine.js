const { LoggerUtil } = require('../util/LoggerUtil');
const { validateLocalFile, safeEnsureDir } = require('../common/FileUtils');
const { ensureDecodedPath, sleep } = require('../util/NodeUtil');
const { dirname, extname } = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const P2PEngine = require('../../../../../network/P2PEngine');
const RaceManager = require('../../../../../network/RaceManager');

const log = LoggerUtil.getLogger('DownloadEngine');

async function downloadQueue(assets, onProgress) {
    P2PEngine.start();
    const limit = 32;
    const receivedTotals = assets.reduce((acc, a) => ({ ...acc, [a.id]: 0 }), {});
    let receivedGlobal = 0;

    let activeDownloads = 0;

    const runDownload = async (asset) => {
        const onEachProgress = (transferred) => {
            receivedGlobal += (transferred - receivedTotals[asset.id]);
            receivedTotals[asset.id] = transferred;
            if (onProgress) onProgress(receivedGlobal);
        };
        await downloadFile(asset, onEachProgress);
    };

    const queue = [...assets];
    const workers = [];

    const worker = async () => {
        while (queue.length > 0) {
            // Dynamic Throttling: Check if we have permission to start another download
            const currentMax = P2PEngine.getOptimalConcurrency(limit);
            if (activeDownloads >= currentMax) {
                await sleep(100);
                continue;
            }

            const asset = queue.shift();
            if (!asset) break;

            activeDownloads++;
            try {
                await runDownload(asset);
            } catch (err) {
                // If downloadFile throws, it means it failed after retries.
                throw err;
            } finally {
                activeDownloads--;
            }
        }
    };

    for (let i = 0; i < limit; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);
    return receivedTotals;
}

async function downloadFile(asset, onProgress) {
    if (!asset || !asset.path) {
        throw new Error('Asset or asset path is null or undefined.');
    }
    const { url, path, algo, hash } = asset;
    const decodedPath = ensureDecodedPath(path);
    const CONFIG_EXTENSIONS = ['.txt', '.json', '.yml', '.yaml', '.dat'];

    // Initial check (Optimistic)
    try {
        await fs.access(decodedPath);
        if (CONFIG_EXTENSIONS.includes(extname(decodedPath))) {
            log.debug(`Skipping download of ${decodedPath} as it already exists.`);
            if (onProgress) onProgress(asset.size); // Account for skipping
            return;
        }
        if (await validateLocalFile(decodedPath, algo, hash)) {
            log.debug(`File already exists and is valid: ${decodedPath}`);
            if (onProgress) onProgress(asset.size); // Account for skipping
            return;
        }
    } catch (e) { }

    await safeEnsureDir(dirname(decodedPath));

    let lastError = null;

    // Retry Loop (Resilience)
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            if (attempt > 0) {
                await sleep(attempt * 1000);
                log.debug(`Retrying download for ${asset.id} (Attempt ${attempt + 1}/5)...`);
            }

            // RaceManager Strategy
            // Construct headers
            const headers = new Headers();
            if (asset.size) headers.append('X-Expected-Size', asset.size.toString());
            if (asset.path) headers.append('X-File-Path', asset.path);
            if (asset.id) headers.append('X-File-Id', asset.id);

            // Force HTTP after 2 failed attempts (P2P might be delivering bad data)
            if (attempt >= 2) {
                headers.append('X-Skip-P2P', 'true');
            }

            // Use RaceManager
            const req = new Request(url, { headers });

            const response = await RaceManager.handle(req);

            if (!response.ok) throw new Error(`RaceManager failed: ${response.status}`);

            const fileStream = fsSync.createWriteStream(decodedPath);

            // Progress tracking wrapper
            let loaded = 0;
            let lastProgressTime = 0;
            const total = asset.size || 0;

            if (response.body) {
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

            // Validate
            if (await validateLocalFile(decodedPath, algo, hash)) {
                return; // Success!
            } else {
                throw new Error('Validation failed');
            }

        } catch (err) {
            lastError = err;
            try { await fs.unlink(decodedPath) } catch (e) { }
            // Continue to next attempt
        }
    }

    // If we're here, all retries failed
    log.error(`Failed to download ${asset.id} after 5 attempts: ${lastError ? lastError.message : 'Unknown error'}`);
    throw lastError || new Error('Download failed after multiple attempts');
}

let activeHttpRequests = 0;

module.exports = { downloadQueue, downloadFile }
