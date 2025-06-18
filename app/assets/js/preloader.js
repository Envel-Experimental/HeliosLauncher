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

                        // Define LWJGLX Module (using placeholder URL)
                        const lwjglxModule = {
                            id: 'org.lwjglx:lwjglx-macos-arm64:0.1.0', // Custom ID
                            name: 'LWJGLX for macOS ARM64 (Hotfix)',
                            type: 'Library',
                            artifact: {
                                url: 'https://f-launcher.ru/fox/new/libs/lwjglx-macos-arm64-0.1.0.jar', // Placeholder URL
                                path: 'org/lwjglx/lwjglx-macos-arm64/0.1.0/lwjglx-macos-arm64-0.1.0.jar'
                            }
                        };
                        addModuleIfNotExists(lwjglxModule);

                        // Define LWJGL 3 Modules
                        const lwjgl3Version = '3.3.1';
                        const lwjgl3BaseUrl = 'https://repo1.maven.org/maven2'; // Standard Maven Central URL
                        const lwjgl3Modules = [
                            { name: 'lwjgl', natives: true }, { name: 'lwjgl-glfw', natives: true },
                            { name: 'lwjgl-jemalloc', natives: true }, { name: 'lwjgl-openal', natives: true },
                            { name: 'lwjgl-opengl', natives: true }, { name: 'lwjgl-stb', natives: true }
                        ];

                        lwjgl3Modules.forEach(modInfo => {
                            // Main JAR
                            addModuleIfNotExists({
                                id: `org.lwjgl:${modInfo.name}:${lwjgl3Version}`,
                                name: `LWJGL 3 - ${modInfo.name} (macOS ARM64 Hotfix)`,
                                type: 'Library',
                                artifact: {
                                    url: `${lwjgl3BaseUrl}/org/lwjgl/${modInfo.name}/${lwjgl3Version}/${modInfo.name}-${lwjgl3Version}.jar`,
                                    path: `org/lwjgl/${modInfo.name}/${lwjgl3Version}/${modInfo.name}-${lwjgl3Version}.jar`
                                }
                            });

                            // Native JAR (if applicable)
                            if (modInfo.natives) {
                                const classifier = 'natives-macos-arm64';
                                addModuleIfNotExists({
                                    id: `org.lwjgl:${modInfo.name}:${lwjgl3Version}:${classifier}`, // ID includes classifier
                                    name: `LWJGL 3 - ${modInfo.name} ${classifier} (macOS ARM64 Hotfix)`,
                                    type: 'Library',
                                    artifact: {
                                        url: `${lwjgl3BaseUrl}/org/lwjgl/${modInfo.name}/${lwjgl3Version}/${modInfo.name}-${lwjgl3Version}-${classifier}.jar`,
                                        path: `org/lwjgl/${modInfo.name}/${lwjgl3Version}/${modInfo.name}-${lwjgl3Version}-${classifier}.jar`,
                                        classifier: classifier
                                    }
                                });
                            }
                        });
                        logger.info(`[Preloader ARM64Patch] Finished modifying modules for server: ${server.rawServer.id}`);
                    }
                }
            }
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