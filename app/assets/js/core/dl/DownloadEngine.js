const { LoggerUtil } = require('../util/LoggerUtil');
const { validateLocalFile, safeEnsureDir } = require('../common/FileUtils');
const { ensureDecodedPath, sleep } = require('../util/NodeUtil');
const { dirname, extname } = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const P2PManager = require('./P2PManager');
const RaceManager = require('../../../../../network/RaceManager');

const log = LoggerUtil.getLogger('DownloadEngine');

async function downloadQueue(assets, onProgress) {
    P2PManager.start();
    const limit = 32; // Concurrency
    const receivedTotals = assets.reduce((acc, a) => ({ ...acc, [a.id]: 0 }), {});
    let receivedGlobal = 0;

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
            const asset = queue.shift();
            try {
                await runDownload(asset);
            } catch (err) {
                // If downloadFile throws, it means it failed after retries.
                throw err;
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

    // RaceManager Strategy
    try {
        // Construct headers
        const headers = new Headers();
        if (asset.size) headers.append('X-Expected-Size', asset.size.toString());

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
            return;
        } else {
            throw new Error('Validation failed');
        }

    } catch (err) {
        log.error(`Failed to download ${asset.id}: ${err.message}`);
        try { await fs.unlink(decodedPath) } catch (e) { }
        throw err;
    }
}

let activeHttpRequests = 0;

module.exports = { downloadQueue, downloadFile }
