const Sentry = require('@sentry/electron/main')

class SentryService {
    init() {
        Sentry.init({
            dsn: 'YOUR_DSN_HERE', // User should provide or we use a fallback
            enabled: process.env.NODE_ENV === 'production'
        })
    }

    captureMessage(message, level = 'info') {
        Sentry.captureMessage(message, level)
    }

    captureException(error) {
        Sentry.captureException(error)
    }
}

module.exports = new SentryService()
