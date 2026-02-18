const { ipcMain } = require('electron');
const { FullRepair } = require('./dl/FullRepair');
const ConfigManager = require('../configmanager');
const P2PEngine = require('../../../../network/P2PEngine');
const { LoggerUtil } = require('./util/LoggerUtil');

const log = LoggerUtil.getLogger('LaunchController');

class LaunchController {
    constructor() {
        this.mainWindow = null;
        this.repair = null;
    }

    setWindow(window) {
        this.mainWindow = window;
    }

    init() {
        // Register IPC Handlers
        ipcMain.handle('dl:start', async (event, options) => {
            return await this.startDownload(options);
        });

        ipcMain.handle('sys:scanJava', async (event, options) => {
            const JavaGuard = require('./java/JavaGuard');
            return await JavaGuard.discoverBestJvmInstallation(
                ConfigManager.getDataDirectory(),
                options.version || null
            );
        });

        ipcMain.handle('sys:validateJava', async (event, path, version) => {
            const JavaGuard = require('./java/JavaGuard');
            return await JavaGuard.validateSelectedJvm(path, version);
        });

        ipcMain.handle('dl:downloadJava', async (event, options) => {
            const { major, distribution } = options;
            const JavaGuard = require('./java/JavaGuard');
            const { downloadFile } = require('./dl/DownloadEngine');

            // 1. Resolve Asset
            // Default to 8 if not provided (safe fallback)
            const javaVersion = major || 8;
            const asset = await JavaGuard.latestOpenJDK(
                javaVersion,
                ConfigManager.getDataDirectory(),
                distribution || null
            );

            if (!asset) {
                throw new Error(`No suitable Java ${javaVersion} found.`);
            }

            // 2. Download
            // Send progress to renderer
            const onProgress = (transferred) => {
                if (this.mainWindow) {
                    const percent = (transferred / asset.size) * 100;
                    this.mainWindow.webContents.send('dl:progress', {
                        type: 'download', // Re-use 'download' type or generic
                        progress: percent,
                        total: asset.size,
                        transferred
                    });
                }
            };

            await downloadFile(asset, onProgress);

            // 3. Extract
            if (this.mainWindow) {
                this.mainWindow.webContents.send('dl:progress', { type: 'extract', progress: 0 });
            }

            const javaPath = await JavaGuard.extractJdk(asset.path);

            // 4. Return
            return javaPath;
        });

        // Ensure P2P Engine is started in Main
        P2PEngine.start();
    }

    async startDownload(options) {
        const { version, serverId } = options;
        log.info(`Starting download for Server: ${serverId}, Version: ${version}`);

        const commonDir = ConfigManager.getCommonDirectory();

        // Note: instanceDirectory should probably be resolved here or passed in. 
        // Based on FullRepair.js, it takes explicit paths.
        // Assuming strict structure for now based on ConfigManager.
        const instanceDir = ConfigManager.getInstanceDirectory();

        // Initialize FullRepair
        this.repair = new FullRepair(
            commonDir,
            instanceDir,
            ConfigManager.getLauncherDirectory(),
            serverId,
            false // isDev
        );

        try {
            // Step 1: Verify
            if (this.mainWindow) this.mainWindow.webContents.send('dl:progress', { type: 'verify', progress: 0 });

            const count = await this.repair.verifyFiles((percent) => {
                if (this.mainWindow) this.mainWindow.webContents.send('dl:progress', { type: 'verify', progress: percent });
            });

            log.info(`Verification complete. Found ${count} assets to process.`);

            // Step 2: Download
            if (this.mainWindow) this.mainWindow.webContents.send('dl:progress', { type: 'download', progress: 0 });

            await this.repair.download((percent) => {
                if (this.mainWindow) this.mainWindow.webContents.send('dl:progress', { type: 'download', progress: percent }); // Normalized 0-100
            });

            log.info('Download complete.');
            return { success: true };

        } catch (err) {
            log.error('Download failed:', err);
            // Must return specific error info if possible
            throw err;
        }
    }
}

module.exports = new LaunchController();
