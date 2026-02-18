const isDev = require('../../isdev')

class SentryWrapper {
    static get Sentry() {
        if (this._sentry) return this._sentry;
        try {
            if (!isDev) {
                this._sentry = require('@sentry/electron/renderer');
            }
        } catch (e) {
            console.warn('Sentry wrapper failed to load module:', e);
        }
        return this._sentry;
    }

    static captureException(err, context = {}) {
        if (this.Sentry) {
            this.Sentry.captureException(err, context);
        }
    }

    static captureMessage(msg, level = 'info') {
        if (this.Sentry) {
            this.Sentry.captureMessage(msg, level);
        }
    }
}

module.exports = { SafeSentry: SentryWrapper };
