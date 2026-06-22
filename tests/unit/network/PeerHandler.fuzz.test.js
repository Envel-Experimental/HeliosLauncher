/**
 * @jest-environment node
 */
const PeerHandler = require('../../../network/PeerHandler')
const EventEmitter = require('events')
const b4a = require('b4a')
const crypto = require('crypto')

// Mock Dependencies
jest.mock('@core/configmanager', () => ({
    getDataDirectory: jest.fn().mockReturnValue('/mock/data'),
    getCommonDirectorySync: jest.fn().mockReturnValue('/mock/common'),
    getLauncherDirectorySync: jest.fn().mockReturnValue('/mock/launcher'),
    getP2PUploadEnabled: jest.fn().mockReturnValue(true),
    getLocalOptimization: jest.fn().mockReturnValue(true)
}))

jest.mock('@network/PeerPersistence', () => ({
    updatePeer: jest.fn()
}))

jest.mock('@network/TrafficState', () => ({
    incrementDownloads: jest.fn(),
    decrementDownloads: jest.fn()
}))

class MockSocket extends EventEmitter {
    constructor() {
        super()
        this.destroyed = false
        this.remoteAddress = '1.2.3.4'
        this.remotePort = 1234
    }
    write(data) {
        this.emit('sent', data)
    }
    destroy() {
        this.destroyed = true
        this.emit('close')
    }
    setTimeout() {}
}

describe('PeerHandler Fuzzing', () => {
    let socket
    let engine
    let handler

    beforeEach(() => {
        jest.resetModules()
        socket = new MockSocket()
        engine = {
            removePeer: jest.fn(),
            onPeerRTTUpdate: jest.fn(),
            isLocalIP: jest.fn().mockReturnValue(false),
            profile: { weight: 5 },
            usageTracker: {
                getCredits: jest.fn().mockReturnValue(1000),
                reserve: jest.fn().mockReturnValue(true),
                refund: jest.fn()
            },
            queueRequest: jest.fn(),
            handleIncomingData: jest.fn(),
            handleIncomingError: jest.fn(),
            handleIncomingEnd: jest.fn(),
            activeUploads: 0,
            incrementUploadCountForIP: jest.fn(),
            decrementUploadCountForIP: jest.fn(),
            onUploadFinished: jest.fn()
        }
        handler = new PeerHandler(socket, engine, { peer: { host: '1.2.3.4' } })
        
        if (handler.metricsInterval) clearInterval(handler.metricsInterval)
    })

    test('Fuzz: Random mutated binary frames should not crash PeerHandler', () => {
        // Run 5000 fuzz cycles with random binary inputs
        for (let i = 0; i < 5000; i++) {
            const type = crypto.randomInt(0, 256)
            const reqId = crypto.randomInt(0, 0xFFFFFFFF)
            const payloadLength = crypto.randomInt(0, 1000)
            const payload = crypto.randomBytes(payloadLength)

            const frame = b4a.alloc(9 + payload.length)
            frame[0] = type
            frame.writeUInt32BE(reqId, 1)
            frame.writeUInt32BE(payload.length, 5)
            payload.copy(frame, 9)

            // Inject the frame
            expect(() => {
                socket.emit('data', frame)
            }).not.toThrow()
        }
    })

    test('Fuzz: Fragmented random bytes chunk inputs', () => {
        // Inject small random byte slices of random length to stress consolidation
        for (let i = 0; i < 1000; i++) {
            const chunk = crypto.randomBytes(crypto.randomInt(1, 20))
            expect(() => {
                socket.emit('data', chunk)
            }).not.toThrow()
        }
    })

    test('Fuzz: Malformed/Prototype Pollution JSON payloads', () => {
        // Build JSON messages for handleRequest (MSG_REQUEST = 1)
        const MSG_REQUEST = 1
        
        const fuzzedObjects = [
            { "__proto__": { "isAdmin": true }, "h": "a".repeat(40) },
            { "constructor": { "prototype": {} }, "h": "a".repeat(40) },
            { "h": "a".repeat(40), "p": "../../../etc/passwd" },
            { "h": "a".repeat(40), "p": ".\\..\\etc\\passwd" },
            { "h": "a".repeat(40), "p": "\u002e\u002e/etc/passwd" },
            { "h": "a".repeat(40), "p": "valid/path\r\n../traversal" },
            { "h": 12345, "p": [] },
            { "h": null },
            { "h": "a".repeat(40), "s": -1 },
            { "h": "a".repeat(40), "s": 9e18 },
            { "h": "a".repeat(40), "s": NaN },
            { "h": "a".repeat(40), "s": Infinity },
            { "h": "a".repeat(64), "p": "a".repeat(4096) },
            {},
            [],
            "not a json",
            "{ malformed json",
        ]

        fuzzedObjects.forEach((obj) => {
            const payload = typeof obj === 'string' ? b4a.from(obj) : b4a.from(JSON.stringify(obj))
            const frame = b4a.alloc(9 + payload.length)
            frame[0] = MSG_REQUEST
            frame.writeUInt32BE(123, 1)
            frame.writeUInt32BE(payload.length, 5)
            payload.copy(frame, 9)

            expect(() => {
                socket.emit('data', frame)
            }).not.toThrow()
        })
    })

    test('Fuzz: HELLO message with variable payload sizes', () => {
        const MSG_HELLO = 5
        const lengths = [0, 1, 2, 5, 10]
        
        lengths.forEach((len) => {
            const payload = crypto.randomBytes(len)
            const frame = b4a.alloc(9 + payload.length)
            frame[0] = MSG_HELLO
            frame.writeUInt32BE(1, 1)
            frame.writeUInt32BE(payload.length, 5)
            payload.copy(frame, 9)

            expect(() => {
                socket.emit('data', frame)
            }).not.toThrow()
        })
    })
})
