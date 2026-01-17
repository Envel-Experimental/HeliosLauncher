const { LoggerUtil } = require('../util/LoggerUtil');
const { validateLocalFile, safeEnsureDir } = require('../common/FileUtils');
const { ensureDecodedPath, sleep } = require('../util/NodeUtil');
const { dirname, extname } = require('path');
const fs = require('fs/promises');

const log = LoggerUtil.getLogger('DownloadEngine');

async function downloadQueue(assets, onProgress) {
    const limit = 15; // Concurrency
    const receivedTotals = assets.reduce((acc, a) => ({ ...acc, [a.id]: 0 }), {});
    let receivedGlobal = 0;

    const runDownload = async (asset) => {
        const onEachProgress = (transferred) => {
             receivedGlobal += (transferred - receivedTotals[asset.id]);
             receivedTotals[asset.id] = transferred;
             if(onProgress) onProgress(receivedGlobal);
        };
        await downloadFile(asset, onEachProgress);
    };

    const queue = [...assets];
    const workers = [];

    const worker = async () => {
        while(queue.length > 0) {
            const asset = queue.shift();
            try {
                await runDownload(asset);
            } catch (err) {
                // If downloadFile throws, it means it failed after retries.
                throw err;
            }
        }
    };

    for(let i=0; i<limit; i++) {
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
             if(onProgress) onProgress(asset.size); // Account for skipping
             return;
        }
        if (await validateLocalFile(decodedPath, algo, hash)) {
             log.debug(`File already exists and is valid: ${decodedPath}`);
             if(onProgress) onProgress(asset.size); // Account for skipping
             return;
        }
    } catch(e) {}

    await safeEnsureDir(dirname(decodedPath));

    const MAX_RETRIES = 5;
    let retryCount = 0;

    while(retryCount <= MAX_RETRIES) {
        if(retryCount > 0) {
             const delay = Math.pow(2, retryCount) * 1000;
             await sleep(delay);
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // Connect timeout

            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if(!response.ok) throw new Error(`HTTP ${response.status}`);

            // Progress tracking
            const contentLength = response.headers.get('content-length');
            const total = parseInt(contentLength, 10);
            let loaded = 0;

            const reader = response.body.getReader();
            const chunks = [];

            while(true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loaded += value.length;
                if(onProgress) onProgress(loaded);
            }

            // Combine chunks
            const bodyBuffer = new Uint8Array(loaded);
            let offset = 0;
            for(const chunk of chunks) {
                bodyBuffer.set(chunk, offset);
                offset += chunk.length;
            }

            await fs.writeFile(decodedPath, bodyBuffer);

            // Re-validate
            if (await validateLocalFile(decodedPath, algo, hash)) {
                return;
            } else {
                 throw new Error(`File validation failed: ${decodedPath}`);
            }

        } catch(err) {
            retryCount++;
            if(retryCount > MAX_RETRIES) throw err;
            log.warn(`Download failed for ${url} (Attempt ${retryCount}): ${err.message}`);
        }
    }
}

module.exports = { downloadQueue, downloadFile }
