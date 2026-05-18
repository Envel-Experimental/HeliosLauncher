const Sentry = require('@sentry/electron/main')

jest.mock('@sentry/electron/main')
jest.mock('electron', () => ({
    app: {
        isPackaged: false,
        isReady: jest.fn().mockReturnValue(false)
    }
}))

// Require service AFTER mock
const SentryService = require('../../../../app/main/SentryService')
const { app } = require('electron')

describe('SentryService', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        SentryService.initialized = false
    })

    test('should initialize with correct DSN', () => {
        app.isPackaged = true
        SentryService.init()
        
        expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({
            dsn: 'http://fl_fc465ee421684c3f90cf4e04bb280d4f@localhost:3000/1',
            tunnel: 'http://localhost:3000/api/flauncher-test/envelope/?sentry_key=fl_fc465ee421684c3f90cf4e04bb280d4f',
            enabled: true
        }))
    })

    test('should be disabled when not in production', () => {
        app.isPackaged = false
        process.env.NODE_ENV = 'development'
        SentryService.init()
        
        expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({
            enabled: false
        }))
    })

    test('should filter out EPERM errors', () => {
        SentryService.init()
        const { beforeSend } = Sentry.init.mock.calls[0][0]
        
        const event = { event_id: '123' }
        const hint = { originalException: { code: 'EPERM' } }
        
        const result = beforeSend(event, hint)
        expect(result).toBeNull()
    })

    test('should filter out EBUSY errors', () => {
        SentryService.init()
        const { beforeSend } = Sentry.init.mock.calls[0][0]
        
        const event = { event_id: '123' }
        const hint = { originalException: { code: 'EBUSY' } }
        
        const result = beforeSend(event, hint)
        expect(result).toBeNull()
    })

    test('should NOT filter out generic errors', () => {
        SentryService.init()
        const { beforeSend } = Sentry.init.mock.calls[0][0]
        
        const event = { event_id: '123' }
        const hint = { originalException: new Error('Critical failure') }
        
        const result = beforeSend(event, hint)
        expect(result).toBe(event)
    })

    test('captureException should call Sentry.captureException', () => {
        const error = new Error('Test error')
        SentryService.captureException(error)
        expect(Sentry.captureException).toHaveBeenCalledWith(error)
    })
})
