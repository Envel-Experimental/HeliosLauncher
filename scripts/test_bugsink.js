const Sentry = require('@sentry/node')

const DSN = 'https://a09dd50b0b264fbca8b31a451d1e0227@flauncher.bugsink.com/1'

console.log('Initializing Sentry with Bugsink DSN...')
Sentry.init({
    dsn: DSN,
    release: 'test-1.0.0',
    environment: 'test'
})

console.log('Sending test message...')
Sentry.captureMessage('Bugsink Test Message from script')

console.log('Sending test exception...')
try {
    throw new Error('Bugsink Test Exception from script')
} catch (e) {
    Sentry.captureException(e)
}

console.log('Waiting for events to send (2s)...')
setTimeout(() => {
    console.log('Done. Check Bugsink dashboard.')
    process.exit(0)
}, 2000)
