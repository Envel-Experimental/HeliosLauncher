const { ipcRenderer } = require('electron');
const fs = require('fs-extra').promises;
const os = require('os');
const path = require('path');

const ConfigManager = require('./configmanager');
const { DistroAPI } = require('./distromanager');
const LangLoader = require('./langloader');
const { LoggerUtil } = require('@envel/helios-core');
const Benchmark = require('./benchmark');
const { HeliosDistribution } = require('@envel/helios-core/common');
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

async function onDistroLoad(data) {
    if (data) {
        if (ConfigManager.getSelectedServer() == null || data.getServerById(ConfigManager.getSelectedServer()) == null) {
            logger.info('Determining default selected server..')
            ConfigManager.setSelectedServer(data.getMainServer().rawServer.id)
            await ConfigManager.save()
        }
    }
    ipcRenderer.send('distributionIndexDone', data != null)
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

async function preinit() {
    try {
        Benchmark.start('ConfigManager.load')
        await ConfigManager.load()
        Benchmark.end('ConfigManager.load')

        DistroAPI['commonDir'] = ConfigManager.getCommonDirectory()
        DistroAPI['instanceDir'] = ConfigManager.getInstanceDirectory()

        LangLoader.setupLanguage()

        // Stale-while-revalidate caching strategy
        const cachedDistroPath = path.join(ConfigManager.getLauncherDirectory(), 'distribution.json')
        let distroLoadedFromCache = false
        try {
            Benchmark.start('cachedDistro.read')
            const distroData = JSON.parse(await fs.readFile(cachedDistroPath, 'UTF-8'))
            Benchmark.end('cachedDistro.read')
            logger.info('Loaded distribution from cache.')

            const mockDistro = {
                getServerById: (id) => {
                    return distroData.servers.find(server => server.id === id)
                },
                getMainServer: () => {
                    return {
                        rawServer: distroData.servers.find(server => server.mainServer)
                    }
                }
            }

            onDistroLoad(mockDistro)
            distroLoadedFromCache = true
        } catch (err) {
            logger.warn('No cached distribution found or cache is corrupt.', err)
        }

        Benchmark.start('DistroAPI.getDistribution')
        DistroAPI.getDistribution()
            .then(heliosDistro => {
                Benchmark.end('DistroAPI.getDistribution')
                logger.info('Loaded distribution index from remote.')
                if (!distroLoadedFromCache) { // If cache was empty, load the new one.
                    onDistroLoad(heliosDistro)
                } else {
                    // Optionally, you could compare the cached and remote versions
                    // and notify the user if there's an update.
                }
            })
            .catch(err => {
                Benchmark.end('DistroAPI.getDistribution')
                logger.error('Failed to load distribution index from remote.', err)
                sendToSentry(`Failed to load distribution index: ${err.message}`, 'error')
                if (!distroLoadedFromCache) { // If cache was empty, we have to error.
                    onDistroLoad(null)
                }
            })

        await fs.rm(path.join(os.tmpdir(), ConfigManager.getTempNativeFolder()), { recursive: true, force: true })
        logger.info('Cleaned natives directory.')

    } catch (error) {
        logger.error('Error during preinitialization:', error)
        sendToSentry(`Error during preinitialization: ${error.message}`, 'error')
    }
}

preinit()