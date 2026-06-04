const RaceManager = require('@network/RaceManager')
const ConfigManager = require('@core/configmanager')
const crypto = require('crypto')

// Mock dependencies to isolate RaceManager
jest.mock('@core/configmanager', () => ({
    getP2POnlyMode: jest.fn().mockReturnValue(false)
}))

jest.mock('@network/NodeAdapter', () => ({
    boostWeight: jest.fn()
}))

jest.mock('@network/TrafficState', () => ({
    isBusy: jest.fn().mockReturnValue(false),
    incrementDownloads: jest.fn(),
    decrementDownloads: jest.fn()
}))

jest.mock('@network/P2PEngine', () => {
    const EventEmitter = require('events')
    class MockStream extends EventEmitter {
        constructor() {
            super()
            this.isGracefulCancel = false
        }
        destroy() {
            this.isGracefulCancel = true
            this.emit('close')
        }
        pipe(dest) {
            this.dest = dest
            return dest
        }
    }
    return {
        peers: [{ id: 'mock-peer' }],
        getLoadStatus: jest.fn().mockReturnValue('normal'),
        requestFile: jest.fn().mockImplementation(() => new MockStream()),
        getNetworkInfo: jest.fn().mockReturnValue({ downloaded: 0, uploaded: 0 }),
        once: jest.fn(),
        off: jest.fn()
    }
})

// Mock global fetch with a very small delay to allow P2P stream to win the race
global.fetch = jest.fn().mockImplementation(() => new Promise(resolve => {
    setTimeout(() => {
        resolve({
            ok: true,
            status: 200,
            body: {}
        })
    }, 5)
}))

describe('RaceManager Fuzzing', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('Fuzz: Randomly corrupted Headers and URLs should not crash RaceManager', async () => {
        const fuzzCycles = 200
        
        for (let i = 0; i < fuzzCycles; i++) {
            // Fuzz inputs
            const urlOptions = [
                'mc-asset://mojang.com/asset.jar',
                'https://mojang.com/asset.jar',
                'http://127.0.0.1/my-file',
                'invalid-url-format',
                '',
                null,
                undefined,
                `https://mojang.com/${crypto.randomBytes(20).toString('hex')}`, // 40-char valid hex
                `https://mojang.com/${crypto.randomBytes(32).toString('hex')}`  // 64-char valid hex
            ]
            const randomUrl = urlOptions[crypto.randomInt(0, urlOptions.length)]

            // Fuzz Headers
            const mockHeaders = new Map()
            
            // Randomly populate headers with valid/invalid types
            const headerValues = [
                '12345',
                'invalid-size',
                '-500',
                '99999999999999',
                '',
                null,
                undefined,
                'sha1',
                crypto.randomBytes(20).toString('hex'), // valid hash
                crypto.randomBytes(32).toString('hex')  // valid sha256 hash
            ]

            if (Math.random() > 0.3) mockHeaders.set('X-Expected-Size', headerValues[crypto.randomInt(0, headerValues.length)])
            if (Math.random() > 0.3) mockHeaders.set('X-File-Path', headerValues[crypto.randomInt(0, headerValues.length)])
            if (Math.random() > 0.3) mockHeaders.set('X-File-Id', headerValues[crypto.randomInt(0, headerValues.length)])
            if (Math.random() > 0.3) mockHeaders.set('X-File-Hash', headerValues[crypto.randomInt(0, headerValues.length)])
            if (Math.random() > 0.5) mockHeaders.set('X-Skip-P2P', 'true')

            const mockRequest = {
                url: randomUrl,
                headers: {
                    get: (name) => {
                        const val = mockHeaders.get(name)
                        if (val === undefined) return null
                        return val
                    }
                }
            }

            try {
                await RaceManager.handle(mockRequest)
            } catch (e) {
                if (e.name === 'TypeError') {
                    console.error('Fuzzer caught TypeError in handle():', e.stack)
                }
                expect(e.name).not.toBe('TypeError')
            }
        }
    })

    test('Fuzz: P2P Stream errors and random stream behavior should not crash RaceManager', async () => {
        const P2PEngine = require('@network/P2PEngine')
        
        // Mock a P2P stream that always wins the race immediately
        let activeStream
        P2PEngine.requestFile.mockImplementation(() => {
            const EventEmitter = require('events')
            class WinningStream extends EventEmitter {
                constructor() {
                    super()
                    this.isGracefulCancel = false
                }
                destroy() {
                    this.isGracefulCancel = true
                    this.emit('close')
                }
                pipe(dest) {
                    this.dest = dest
                    return dest
                }
            }
            activeStream = new WinningStream()
            
            // Trigger readable in next tick so it wins the race
            process.nextTick(() => {
                activeStream.emit('readable')
            })
            
            return activeStream
        })

        const mockRequest = {
            url: 'mc-asset://mojang.com/asset.jar',
            headers: {
                get: (name) => {
                    if (name === 'X-File-Hash') return crypto.randomBytes(20).toString('hex')
                    if (name === 'X-Expected-Size') return '1000'
                    return null
                }
            }
        }

        const fuzzCycles = 200
        for (let i = 0; i < fuzzCycles; i++) {
            const response = await RaceManager.handle(mockRequest)
            expect(response.ok).toBe(true)
            expect(response.p2pStream).toBeDefined()

            // Fuzz stream errors/anomalies
            const errorTypes = [
                new Error('Connection reset'),
                'raw-string-error',
                null,
                undefined,
                { code: 'ECONNRESET', custom: true }
            ]

            const randomError = errorTypes[crypto.randomInt(0, errorTypes.length)]

            // Emit errors/anomalies inside the source stream
            expect(() => {
                if (Math.random() > 0.5) {
                    activeStream.emit('error', randomError)
                } else {
                    activeStream.emit('close')
                }
            }).not.toThrow()
        }
    })
})
