const { PassThrough, Readable } = require('stream')
const crypto = require('crypto')
const os = require('os')

describe('P2PEngine - Network Orchestration Tests', () => {
    let p2pEngine
    let ConfigManager
    let PeerHandlerMock
    let RateLimiter

    beforeEach(() => {
        jest.resetModules()
        jest.useFakeTimers()

        // Mock Hyperswarm/DHT
        jest.doMock('hyperswarm', () => jest.fn().mockImplementation(() => ({
            on: jest.fn(),
            join: jest.fn().mockReturnValue({ flushed: jest.fn().mockResolvedValue() }),
            destroy: jest.fn().mockResolvedValue(),
            peers: [],
            flushed: jest.fn().mockResolvedValue()
        })))

        // Mock ConfigManager
        jest.doMock('@core/configmanager', () => ({
            getSettings: jest.fn().mockReturnValue({
                deliveryOptimization: { globalOptimization: true }
            }),
            getP2PUploadLimit: jest.fn().mockReturnValue(15),
            isLoaded: jest.fn().mockReturnValue(true),
            getLauncherDirectorySync: jest.fn().mockReturnValue('/mock/launcher'),
            getP2PUploadEnabled: jest.fn().mockReturnValue(true),
            getLocalOptimization: jest.fn().mockReturnValue(true),
            getCommonDirectorySync: jest.fn().mockReturnValue('/mock/common'),
            getDataDirectory: jest.fn().mockReturnValue('/mock/data')
        }))

        // Mock RateLimiter
        jest.doMock('@core/util/RateLimiter', () => ({
            update: jest.fn()
        }))

        // Mock PeerHandler
        PeerHandlerMock = jest.fn().mockImplementation((socket, engine, info) => ({
            socket: socket || { 
                on: jest.fn(), 
                off: jest.fn(), 
                destroyed: false, 
                setMaxListeners: jest.fn(),
                destroy: jest.fn(),
                setTimeout: jest.fn()
            },
            engine,
            info,
            rtt: 100,
            remoteWeight: 1,
            currentTransferSpeed: 1024,
            isLocal: jest.fn().mockReturnValue(false),
            getIP: jest.fn().mockReturnValue('1.1.1.1'),
            getID: jest.fn().mockReturnValue('peer1')
        }))
        jest.doMock('@network/PeerHandler', () => PeerHandlerMock)

        const P2PEngineModule = require('@network/P2PEngine')
        p2pEngine = P2PEngineModule
        ConfigManager = require('@core/configmanager')
        RateLimiter = require('@core/util/RateLimiter')

        // IMPORTANT: P2PEngine checks this.swarm to continue loops
        p2pEngine.swarm = { flushed: jest.fn().mockResolvedValue() }
    })

    afterEach(() => {
        jest.restoreAllMocks()
        jest.useRealTimers()
    })

    describe('Peer Selection & Scoring', () => {
        test('should fallback to second best peer if the first one fails', async () => {
            const peer1 = new PeerHandlerMock()
            peer1.getID.mockReturnValue('peer1')
            peer1.rtt = 50
            peer1.getIP.mockReturnValue('1.1.1.1')

            const peer2 = new PeerHandlerMock()
            peer2.getID.mockReturnValue('peer2')
            peer2.rtt = 100
            peer2.getIP.mockReturnValue('2.2.2.2')

            p2pEngine.peers = [peer1, peer2]

            let callCount = 0
            const executeSpy = jest.spyOn(p2pEngine, '_executeSingleRequest').mockImplementation(async (peer) => {
                callCount++
                if (peer === peer1) throw new Error('Peer 1 Busy')
                return Promise.resolve()
            })

            p2pEngine.requestFile('mock-hash')
            
            // Initial async steps
            for (let i = 0; i < 5; i++) await Promise.resolve()
            
            // Advance timers for retry sleep (200ms)
            jest.advanceTimersByTime(200)
            
            // Retry async steps
            for (let i = 0; i < 10; i++) await Promise.resolve()

            expect(callCount).toBe(2)
        })
    })

    describe('Penalties & Security', () => {
        test('should blacklist peer after 3 strikes', () => {
            const peer = new PeerHandlerMock()
            peer.getID.mockReturnValue('bad-peer')
            peer.getIP.mockReturnValue('6.6.6.6')

            p2pEngine.penalizePeer(peer, true) // 1
            p2pEngine.penalizePeer(peer, true) // 2
            p2pEngine.penalizePeer(peer, true) // 3
            
            expect(p2pEngine.blacklist.has('bad-peer')).toBe(true)
            expect(peer.socket.destroy).toHaveBeenCalledTimes(3)
        })
    })

    describe('Bandwidth & Limits (AIMD Logic)', () => {
        test('updateDynamicLimits should increase limit when congestion is low', () => {
            p2pEngine.currentUploadLimitMbps = 5
            p2pEngine.congestionDetected = false
            p2pEngine.slowStart = true
            p2pEngine.lastStepUpTime = 0 

            p2pEngine.updateDynamicLimits()

            expect(p2pEngine.currentUploadLimitMbps).toBe(7.5)
        })
    })
})
