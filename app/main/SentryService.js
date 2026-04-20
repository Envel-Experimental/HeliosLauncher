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
            Sentry.init({
                dsn: 'https://f02442d2a0733ac2c810b8d8d7f4a21e@o4508545424359424.ingest.de.sentry.io/4508545432027216',
                enabled: isProd,
                beforeSend(event, hint) {
                    const error = hint.originalException
                    if (error) {
                        // Filter out EPERM/EBUSY (common on Windows during file cleanup)
                        if (error.code === 'EPERM' || error.code === 'EBUSY') {
                            return null
                        }
                        // Filter out known noisy messages
                        if (typeof error.message === 'string' && error.message.includes('fs:statfs')) {
                            // If it's the duplicate handler error, we want to know, but maybe not spam
                            // However, we are fixing it now.
                        }
                    }
                    return event
                }
            })
        } catch (e) {
            console.error('[SentryService] Failed to initialize Sentry:', e)
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
