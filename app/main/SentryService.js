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
            } catch (e) {
                // Fallback if version.json is missing (e.g. dev without bundle)
            }

            Sentry.init({
                dsn: 'https://f02442d2a0733ac2c810b8d8d7f4a21e@o4508545424359424.ingest.de.sentry.io/4508545432027216',
                enabled: isProd,
                release: release,
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
        } catch (e) {
            console.error('[SentryService] Failed to initialize Sentry:', e)
        }
    }

    captureMessage(message, level = 'info') {
        Sentry.captureMessage(message, level)
    }

    captureException(error) {
        if (typeof error === 'string') {
            if (error.includes('\n') && error.includes('at ')) {
                const firstLine = error.split('\n')[0]
                const msg = firstLine.replace(/^[a-zA-Z_$][a-zA-Z0-9_$]*Error:\s*/, '')
                const reconstructedError = new Error(msg)
                reconstructedError.stack = error
                
                const match = firstLine.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*Error):/)
                if (match) {
                    reconstructedError.name = match[1]
                }
                
                Sentry.captureException(reconstructedError)
                return
            } else {
                Sentry.captureException(new Error(error))
                return
            }
        }
        Sentry.captureException(error)
    }
}

module.exports = new SentryService()
