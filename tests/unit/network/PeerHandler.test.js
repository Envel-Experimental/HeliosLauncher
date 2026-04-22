const PeerHandler = require('@network/PeerHandler')
const { MSG_HELLO, MSG_PING, MSG_PONG } = require('@network/constants')
const EventEmitter = require('events')
const b4a = require('b4a')

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

describe('PeerHandler', () => {
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
            usageTracker: { getCredits: jest.fn().mockReturnValue(1000) }
        }
        handler = new PeerHandler(socket, engine, { peer: { host: '1.2.3.4' } })
        
        if (handler.metricsInterval) clearInterval(handler.metricsInterval)
    })

    test('should handle MSG_PING and respond with MSG_PONG', () => {
        const spyWrite = jest.spyOn(socket, 'write')
        
        const header = b4a.alloc(9)
        header[0] = MSG_PING
        header.writeUInt32BE(789, 1)
        header.writeUInt32BE(0, 5)

        socket.emit('data', header)
        
        const pongCall = spyWrite.mock.calls.find(call => call[0][0] === MSG_PONG)
        expect(pongCall).toBeDefined()
        expect(pongCall[0].readUInt32BE(1)).toBe(789)
    })

    test('should handle MSG_HELLO', () => {
        const payload = b4a.alloc(2)
        payload.writeUInt8(30, 0)
        payload.writeUInt8(0x01, 1)

        const header = b4a.alloc(9)
        header[0] = MSG_HELLO
        header.writeUInt32BE(0, 1)
        header.writeUInt32BE(payload.length, 5)

        socket.emit('data', b4a.concat([header, payload]))
        
        expect(handler.remoteWeight).toBe(30)
        expect(handler.batchSupport).toBe(true)
    })

    test('should handle fragmented header and body', () => {
        const header = b4a.alloc(9)
        header[0] = MSG_PING
        header.writeUInt32BE(1, 1)
        header.writeUInt32BE(0, 5)

        // Send byte by byte
        for (let i = 0; i < header.length; i++) {
            socket.emit('data', header.subarray(i, i + 1))
        }
        
        expect(handler.chunksLen).toBe(0)
    })
})
