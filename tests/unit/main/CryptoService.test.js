const { ipcMain } = require('electron')
const CryptoService = require('../../../app/main/CryptoService')
const crypto = require('crypto')

describe('CryptoService', () => {
    let handlers = {}
    let listeners = {}

    beforeAll(() => {
        ipcMain.handle.mockImplementation((channel, handler) => {
            handlers[channel] = handler
        })
        ipcMain.on.mockImplementation((channel, listener) => {
            listeners[channel] = listener
        })
        CryptoService.init()
    })

    beforeEach(() => {
        jest.clearAllMocks()
    })

    describe('crypto:hashSync', () => {
        it('should generate hash synchronously', () => {
            const event = { returnValue: null }
            const data = 'test-data'
            const algorithm = 'sha256'
            const expectedHash = crypto.createHash(algorithm).update(data).digest('hex')

            listeners['crypto:hashSync'](event, algorithm, data)
            expect(event.returnValue).toBe(expectedHash)
        })

        it('should return null on invalid algorithm', () => {
            const event = { returnValue: null }
            listeners['crypto:hashSync'](event, 'invalid-algo', 'data')
            expect(event.returnValue).toBeNull()
        })
    })

    describe('crypto:hash', () => {
        it('should generate hash asynchronously', async () => {
            const data = 'test-data-async'
            const algorithm = 'md5'
            const expectedHash = crypto.createHash(algorithm).update(data).digest('hex')

            const result = await handlers['crypto:hash']({}, algorithm, data)
            expect(result).toBe(expectedHash)
        })

        it('should return null on failure', async () => {
            const result = await handlers['crypto:hash']({}, 'invalid-algo', 'data')
            expect(result).toBeNull()
        })
    })
})
