const Sentry = require('@sentry/electron/main')

class SentryService {
    init() {
        if (this.initialized) return
        this.initialized = true

        const { app } = require('electron')
        const isProd = app.isPackaged || process.env.NODE_ENV === 'production'

        if (app.isReady()) {
            console.warn('[SentryService] Sentry was initialized AFTER app ready. This is not recommended.')
        }

        try {
            let release = undefined
            try {
                const versionData = require('../assets/version.json')
                release = versionData.release
                console.log('[SentryService] Loaded release from version.json:', release)
            } catch (e) {
                console.warn('[SentryService] Could not load release from version.json:', e.message)
            }

            const enabled = isProd || process.env.TEST_FORTENLOG === 'true'

            Sentry.init({
                dsn: 'http://fl_fc465ee421684c3f90cf4e04bb280d4f@localhost:3000/1', // Numeric DSN to bypass client-side projectId validation
                tunnel: 'http://localhost:3000/api/flauncher-test/envelope/?sentry_key=fl_fc465ee421684c3f90cf4e04bb280d4f', // Tunnel to project with key query param
                enabled: enabled,
                release: release,
                debug: enabled, // Enable Sentry debug logs in test/development mode to verify exact transmission
                beforeSend(event, hint) {
                    const error = hint.originalException
                    const message = (error && error.message) || event.message || ''
                    const code = (error && error.code) || ''
                    
                    if (typeof message === 'string') {
                        if (
                            message.includes('is not signed by the application owner') ||
                            message.includes('fs:statfs') ||
                            message.includes('ERR_CONNECTION_RESET') ||
                            message.includes('ENOSPC') ||
                            message.includes('EPERM') ||
                            message.includes('EBUSY') ||
                            code === 'EPERM' ||
                            code === 'EBUSY' ||
                            code === 'ENOSPC'
                        ) {
                            return null
                        }
                    }
                    return event
                },
                beforeBreadcrumb(breadcrumb) {
                    if (breadcrumb.category === 'console' && breadcrumb.level === 'error') {
                        const message = breadcrumb.message || ''
                        if (message.includes('is not signed by the application owner')) {
                            return null
                        }
                    }
                    return breadcrumb
                }
            })

            // Setup hardware enrichment once the app becomes ready
            if (enabled) {
                if (app.isReady()) {
                    this.enrichHardwareContextAndSendTest()
                } else {
                    app.on('ready', () => {
                        // Short delay to ensure GPU process is active and screen resolution is initialized
                        setTimeout(() => {
                            this.enrichHardwareContextAndSendTest()
                        }, 2000)
                    })
                }
            }
        } catch (e) {
            console.error('[SentryService] Failed to initialize Sentry:', e)
        }
    }

    enrichHardwareContextAndSendTest() {
        try {
            const os = require('os')
            const { screen, app } = require('electron')

            const cpuModel = os.cpus() && os.cpus().length > 0 ? os.cpus()[0].model : 'Unknown Processor'
            const totalMemGb = Math.round(os.totalmem() / (1024 * 1024 * 1024))
            
            let screenRes = '1920x1080' // default fallback
            try {
                const primaryDisplay = screen.getPrimaryDisplay()
                if (primaryDisplay && primaryDisplay.size) {
                    screenRes = `${primaryDisplay.size.width}x${primaryDisplay.size.height}`
                }
            } catch (e) {
                console.warn('[SentryService] Could not resolve screen resolution:', e.message)
            }

            console.log('[SentryService] Enriching Sentry context with hardware specs:')
            console.log(` - CPU: ${cpuModel}`)
            console.log(` - RAM: ${totalMemGb} GB`)
            console.log(` - Resolution: ${screenRes}`)

            Sentry.setContext('device', {
                arch: process.arch,
                processor_count: os.cpus() ? os.cpus().length : 1,
                memory_size: os.totalmem(),
                screen_resolution: screenRes,
                model: 'Desktop PC'
            })

            Sentry.setContext('cpu', {
                processor_name: cpuModel
            })

            Sentry.setContext('gpu', {
                name: 'Integrated Graphics' // fallback
            })

            // Async query of precise GPU info
            app.getGPUInfo('basic').then((gpuInfo) => {
                let gpuName = 'Integrated Graphics'
                if (gpuInfo && gpuInfo.gpuDevice && gpuInfo.gpuDevice.length > 0) {
                    gpuName = gpuInfo.gpuDevice[0].deviceString || 'Integrated Graphics'
                }
                console.log(' - GPU:', gpuName)
                Sentry.setContext('gpu', {
                    name: gpuName
                })
                
                console.log('[SentryService] Sending fully-enriched verification message to FortenLog Sentry API...')
                Sentry.captureMessage('FortenLog Sentry Integration Verified')

                console.log('[SentryService] Sending fully-enriched test exception to FortenLog Sentry API...')
                Sentry.captureException(new Error('Test Crash: FortenLog Exception Tracking Verified'))
            }).catch((err) => {
                console.warn('[SentryService] Failed to query GPU info:', err.message)
                console.log('[SentryService] Sending partially-enriched verification message to FortenLog Sentry API...')
                Sentry.captureMessage('FortenLog Sentry Integration Verified')

                console.log('[SentryService] Sending partially-enriched test exception to FortenLog Sentry API...')
                Sentry.captureException(new Error('Test Crash: FortenLog Exception Tracking Verified'))
            })
        } catch (e) {
            console.error('[SentryService] Error during hardware enrichment:', e)
        }
    }

    captureMessage(message, level = 'info') {
        Sentry.captureMessage(message, level)
    }

    captureException(error) {
        Sentry.captureException(error)
    }
}

module.exports = new SentryService()

