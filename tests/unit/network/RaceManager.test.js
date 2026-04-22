const { PassThrough, Readable } = require('stream')
const crypto = require('crypto')

describe('RaceManager - High Fidelity Tests', () => {
    let RaceManager
    let P2PEngine
    let ConfigManager
    let TrafficState
    let HashVerifierStream

    beforeEach(() => {
        jest.resetModules()
        jest.useFakeTimers()

        // Mock P2PEngine (Singleton)
        jest.doMock('@network/P2PEngine', () => ({
            requestFile: jest.fn(),
            getLoadStatus: jest.fn().mockReturnValue('normal'),
            peers: [{ id: 'peer1' }],
            once: jest.fn(),
            off: jest.fn(),
            getNetworkInfo: jest.fn().mockReturnValue({ downloaded: 0, uploaded: 0 }),
            emit: jest.fn()
        }))

        // Mock ConfigManager
        jest.doMock('@core/configmanager', () => ({
            getP2POnlyMode: jest.fn().mockReturnValue(false),
            getSettings: jest.fn().mockReturnValue({
                deliveryOptimization: { globalOptimization: true }
            })
        }))

        // Mock TrafficState
        jest.doMock('@network/TrafficState', () => ({
            isBusy: jest.fn().mockReturnValue(false),
            incrementDownloads: jest.fn(),
            decrementDownloads: jest.fn()
        }))

        // Real HashVerifierStream
        HashVerifierStream = require('@network/HashVerifierStream')
        jest.doMock('@network/HashVerifierStream', () => HashVerifierStream)

        // Mock NodeAdapter
        jest.doMock('@network/NodeAdapter', () => ({
            boostWeight: jest.fn(),
            boostPriority: jest.fn()
        }))

        // Mock isDev
        jest.doMock('@core/isdev', () => true)

        // Mock global fetch
        global.fetch = jest.fn()

        RaceManager = require('@network/RaceManager')
        P2PEngine = require('@network/P2PEngine')
        ConfigManager = require('@core/configmanager')
        TrafficState = require('@network/TrafficState')
    })

    afterEach(() => {
        jest.clearAllTimers()
        jest.useRealTimers()
    })

    const createMockRequest = (url, hash = null) => ({
        url,
        headers: {
            get: jest.fn(key => {
                if (key === 'X-File-Hash') return hash
                return null
            })
        }
    })

    describe('Racing Logic (The Heart)', () => {
        
        test('Scenario: HTTP wins quickly, P2P is canceled', async () => {
            const hash = crypto.randomBytes(20).toString('hex')
            const mockReq = createMockRequest('https://files.com/test.jar', hash)
            
            const httpStream = new PassThrough()
            global.fetch.mockResolvedValue({
                ok: true,
                body: httpStream
            })

            const p2pStream = new PassThrough()
            P2PEngine.requestFile.mockReturnValue(p2pStream)
            const p2pDestroySpy = jest.spyOn(p2pStream, 'destroy')

            const resultPromise = RaceManager.handle(mockReq)
            
            // Advance microtasks
            await Promise.resolve()
            await Promise.resolve()
            
            const result = await resultPromise
            expect(result.ok).toBe(true)
            expect(p2pDestroySpy).toHaveBeenCalled()
        })

        test('Scenario: P2P Discovery Grace Period', async () => {
            const hash = crypto.randomBytes(20).toString('hex')
            const mockReq = createMockRequest('https://files.com/test.jar', hash)
            
            global.fetch.mockReturnValue(new Promise(() => {}))

            // Mock 0 peers initially
            P2PEngine.peers = []
            let peerCallback
            P2PEngine.once.mockImplementation((event, cb) => {
                if (event === 'peer_added') peerCallback = cb
            })

            // Mock requestFile to return a stream when called
            const p2pStream = new PassThrough()
            P2PEngine.requestFile.mockReturnValue(p2pStream)

            const resultPromise = RaceManager.handle(mockReq)
            
            // Discovery wait starts
            await Promise.resolve()
            expect(P2PEngine.requestFile).not.toHaveBeenCalled()

            // Simulate peer discovery
            P2PEngine.peers = [{ id: 'peer1' }]
            if (peerCallback) peerCallback()

            // Wait for discovery promise to resolve and handle to continue
            await Promise.resolve()
            await Promise.resolve()
            await Promise.resolve()
            
            expect(P2PEngine.requestFile).toHaveBeenCalled()
            
            // Emit data
            p2pStream.emit('readable')
            
            const result = await resultPromise
            expect(result.ok).toBe(true)
            expect(result.p2pStream).toBeDefined()
        })
    })

    describe('Integrity & Security', () => {
        
        test('Scenario: P2P Hash Mismatch', async () => {
            const originalData = Buffer.from('correct data')
            const corruptData = Buffer.from('corrupt data')
            const correctHash = crypto.createHash('sha1').update(originalData).digest('hex')
            
            const mockReq = createMockRequest('https://files.com/test.jar', correctHash)
            global.fetch.mockReturnValue(new Promise(() => {}))

            const p2pStream = new PassThrough()
            P2PEngine.requestFile.mockReturnValue(p2pStream)

            const resultPromise = RaceManager.handle(mockReq)
            
            await Promise.resolve()
            p2pStream.emit('readable')
            const result = await resultPromise
            
            const verifierStream = result.p2pStream
            
            // Listen for error
            let caughtError
            verifierStream.on('error', err => caughtError = err)
            
            // Push data
            p2pStream.push(corruptData)
            p2pStream.push(null)

            // Wait for flush
            await new Promise(resolve => verifierStream.on('close', resolve))

            expect(caughtError.code).toBe('HASH_MISMATCH')
        })

        test('Scenario: P2P Only Mode enforcement', async () => {
            ConfigManager.getP2POnlyMode.mockReturnValue(true)
            
            const mockReq = createMockRequest('https://minecraft.net/download/hash', 'hash')
            
            const p2pStream = new PassThrough()
            P2PEngine.requestFile.mockReturnValue(p2pStream)

            const resultPromise = RaceManager.handle(mockReq)
            
            await Promise.resolve()
            // Fail P2P
            p2pStream.emit('error', new Error('No Peers'))
            
            await expect(resultPromise).rejects.toThrow()
            expect(global.fetch).not.toHaveBeenCalled()
        })
    })

    describe('Resource Management', () => {
        test('Scenario: Loser cleanup on fast winner', async () => {
            const hash = crypto.randomBytes(20).toString('hex')
            const mockReq = createMockRequest('https://files.com/test.jar', hash)

            const p2pStream = new PassThrough()
            P2PEngine.requestFile.mockReturnValue(p2pStream)

            let abortSignal
            global.fetch.mockImplementation((url, options) => {
                abortSignal = options.signal
                return new Promise(() => {})
            })

            const resultPromise = RaceManager.handle(mockReq)
            
            await Promise.resolve()
            p2pStream.emit('readable')
            
            await resultPromise
            
            expect(abortSignal.aborted).toBe(true)
        })
    })
})
