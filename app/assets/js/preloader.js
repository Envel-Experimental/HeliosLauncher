const { ipcRenderer } = require('electron');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const ConfigManager = require('./configmanager');
const { DistroAPI } = require('./distromanager');
const LangLoader = require('./langloader');
const { LoggerUtil } = require('helios-core');
const { HeliosDistribution } = require('helios-core/common');
let Sentry;

const logger = LoggerUtil.getLogger('Preloader');

logger.info('Loading..');

try {
  Sentry = require('@sentry/electron/renderer');
  Sentry.init({
    dsn: "https://f02442d2a0733ac2c810b8d8d7f4a21e@o4508545424359424.ingest.de.sentry.io/4508545432027216",
  });

  const systemInfo = {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    hostname: os.hostname(),
  };

  Sentry.setContext("system", systemInfo);
} catch (error) {
  logger.warn('Sentry initialization failed:', error);
}

ConfigManager.load();

DistroAPI['commonDir'] = ConfigManager.getCommonDirectory();
DistroAPI['instanceDir'] = ConfigManager.getInstanceDirectory();

LangLoader.setupLanguage();

function onDistroLoad(data) {
  if (data) {
    if (ConfigManager.getSelectedServer() == null || data.getServerById(ConfigManager.getSelectedServer()) == null) {
      logger.info('Determining default selected server..');
      ConfigManager.setSelectedServer(data.getMainServer().rawServer.id);
      ConfigManager.save();
    }
  }
  ipcRenderer.send('distributionIndexDone', data !== null);
}

// Capture log or error and send to Sentry
function sendToSentry(message, type = 'info') {
  if (Sentry) {
    if (type === 'error') {
      Sentry.captureException(new Error(message));
    } else {
      Sentry.captureMessage(message);
    }
  }
}

module.exports = { sendToSentry };

DistroAPI.getDistribution()
  .then(heliosDistro => {
    logger.info('Loaded distribution index.');

    // macOS ARM64 LWJGL Hotfix
    if (heliosDistro && heliosDistro.servers) {
        const isMacOSArm64 = process.platform === 'darwin' && process.arch === 'arm64';
        logger.info(`[Preloader ARM64Patch] Detection: isMacOSArm64=${isMacOSArm64}`);

        if (isMacOSArm64) {
            for (const server of heliosDistro.servers) {
                if (server && server.rawServer) { // Check if server and rawServer exist
                    const mcVersion = server.rawServer.minecraftVersion;

                    const localMcVersionAtLeast = (version, comparisonVersion) => {
                        const vParts = version.split('.').map(Number);
                        const cParts = comparisonVersion.split('.').map(Number);
                        for (let i = 0; i < Math.max(vParts.length, cParts.length); i++) {
                            const v = vParts[i] || 0;
                            const c = cParts[i] || 0;
                            if (v < c) return false;
                            if (v > c) return true;
                        }
                        return true;
                    };

                    const needsLwjglx = !localMcVersionAtLeast('1.19', mcVersion);
                    logger.info(`[Preloader ARM64Patch] Server: ${server.rawServer.id}, MC Version: ${mcVersion}, needsLwjglx=${needsLwjglx}`);

                    if (needsLwjglx) {
                        logger.info(`[Preloader ARM64Patch] Modifying modules for server: ${server.rawServer.id}`);
                        server.modules = server.modules || [];

                        // Helper to add module if not already present by ID
                        const addModuleIfNotExists = (mod) => {
                            if (!server.modules.find(existingMod => existingMod.id === mod.id)) {
                                server.modules.push(mod);
                                logger.info(`[Preloader ARM64Patch] Added module: ${mod.id}`);
                            } else {
                                logger.info(`[Preloader ARM64Patch] Module already exists: ${mod.id}`);
                            }
                        };

                        // LWJGLX Module has been removed.

                        // LWJGL 3 Modules have been removed.
                        logger.info(`[Preloader ARM64Patch] Finished (now only JRE) modifying modules for server: ${server.rawServer.id}`);
                    }
                }
            }

            // Rosetta JRE Injection (still within isMacOSArm64 block)
            logger.info('[Preloader RosettaJRE] Starting JRE check for macOS ARM64 servers.');
            // Temporary mcVersionAtLeast helper - IMPORTANT: This is defined *within* the ARM64Patch block for LWJGL,
            // ensure it's available here or redefine if this JRE block is fully separate.
            // For this replacement, we assume it might have been part of the shared scope or needs redefinition.
            const localMcVersionAtLeast = (version, comparisonVersion) => {
                const vParts = version.split('.').map(Number);
                const cParts = comparisonVersion.split('.').map(Number);
                for (let i = 0; i < Math.max(vParts.length, cParts.length); i++) {
                    const v = vParts[i] || 0;
                    const c = cParts[i] || 0;
                    if (v < c) return false;
                    if (v > c) return true;
                }
                return true;
            };

            for (const server of heliosDistro.servers) {
                if (server && server.rawServer && server.rawServer.minecraftVersion) {
                    const mcVersion = server.rawServer.minecraftVersion;
                    const needsRosettaJRE = !localMcVersionAtLeast('1.19', mcVersion);
                    logger.info(`[Preloader RosettaJRE] Server: ${server.rawServer.id}, MC Version: ${mcVersion}, needsRosettaJRE=${needsRosettaJRE}`);

                    if (needsRosettaJRE) {
                        logger.info(`[Preloader RosettaJRE] Modifying modules for server: ${server.rawServer.id} to include x86_64 Java 8 JRE.`);
                        server.modules = server.modules || [];

                        const addModuleIfNotExists = (mod) => {
                            // Remove any other JavaRuntime module first to ensure only one is present if switching versions
                            server.modules = server.modules.filter(existingMod => existingMod.type !== 'JavaRuntime' || existingMod.id === mod.id);
                            if (!server.modules.find(existingMod => existingMod.id === mod.id)) {
                                server.modules.push(mod);
                                logger.info(`[Preloader RosettaJRE] Added module: ${mod.id}`);
                            } else {
                                logger.info(`[Preloader RosettaJRE] Module already exists or was updated: ${mod.id}`);
                            }
                        };

                        const x86JREModule = {
                            id: 'com.azul.zulu:jre-macos-x86_64:8.0.402',
                            name: 'Azul Zulu JRE 8u402 (x86_64 for Rosetta)',
                            type: 'JavaRuntime',
                            archiveTargetPath: 'java/zulu8.0.402-jre-macosx_x64',
                            internalExecutablePath: 'zulu8.76.0.17-ca-jre8.0.402-macosx_x64/Contents/Home/bin/java', // VERIFY THIS PATH
                            artifact: {
                                url: 'https://cdn.azul.com/zulu/bin/zulu8.76.0.17-ca-jre8.0.402-macosx_x64.tar.gz',
                                MD5: null,
                                size: null,
                                path: 'java-archives/zulu8.76.0.17-ca-jre8.0.402-macosx_x64.tar.gz'
                            }
                        };
                        addModuleIfNotExists(x86JREModule);
                        // logger.info within addModuleIfNotExists covers the addition.
                    }
                } else {
                    logger.warn('[Preloader RosettaJRE] Server or server.rawServer or server.rawServer.minecraftVersion is undefined, skipping JRE check for this server.');
                }
            }
            logger.info('[Preloader RosettaJRE] Finished JRE checks for all servers.');
        }
    }

    onDistroLoad(heliosDistro);
  })
  .catch(err => {
    logger.error('Failed to load distribution index:', err);
    sendToSentry(`Failed to load distribution index: ${err.message}`, 'error');
    onDistroLoad(null);
  });

fs.remove(path.join(os.tmpdir(), ConfigManager.getTempNativeFolder()), (err) => {
  if (err) {
    logger.warn('Error while cleaning natives directory:', err);
    sendToSentry(`Error cleaning natives directory: ${err.message}`, 'error');
  } else {
    logger.info('Cleaned natives directory.');
  }
});