describe('P2PEngine Detailed Tests', () => {
    let p2pEngine
    let ConfigManager
    let Hyperswarm
    let HyperDHT

    beforeEach(() => {
        jest.resetModules()

        // Mock Dependencies
        jest.doMock('hyperswarm', () => {
            return jest.fn().mockImplementation(() => ({
                on: jest.fn(),
                join: jest.fn().mockReturnValue({ flushed: jest.fn().mockResolvedValue() }),
                destroy: jest.fn().mockResolvedValue(),
                peers: [],
                flushed: jest.fn().mockResolvedValue()
            }))
        })

        jest.doMock('hyperdht', () => {
            return jest.fn().mockImplementation(() => ({
                on: jest.fn(),
                destroy: jest.fn().mockResolvedValue()
            }))
        })

        jest.doMock('@core/configmanager', () => ({
            getSettings: jest.fn().mockReturnValue({
                deliveryOptimization: { globalOptimization: true }
            }),
            getP2PUploadLimit: jest.fn().mockReturnValue(15),
            isLoaded: jest.fn().mockReturnValue(true),
            getLauncherDirectorySync: jest.fn().mockReturnValue('/mock/launcher'),
            getDataDirectory: jest.fn().mockReturnValue('/mock/data'),
            getCommonDirectory: jest.fn().mockReturnValue('/mock/common'),
            getLocalOptimization: jest.fn().mockReturnValue(true),
            getP2PUploadEnabled: jest.fn().mockReturnValue(true)
        }))

        jest.doMock('@network/NodeAdapter', () => ({
            getProfile: jest.fn().mockReturnValue({ maxPeers: 10, passive: false }),
            isCritical: jest.fn().mockReturnValue(false)
        }))

        jest.doMock('@network/PeerPersistence', () => ({
            load: jest.fn().mockResolvedValue(),
            getPeers: jest.fn().mockReturnValue([])
        }))

        jest.doMock('@network/StatsManager', () => ({
            init: jest.fn(),
            record: jest.fn()
        }))

        jest.doMock('@network/ResourceMonitor', () => ({
            stop: jest.fn()
        }))

        p2pEngine = require('@network/P2PEngine')
        ConfigManager = require('@core/configmanager')
        Hyperswarm = require('hyperswarm')
        HyperDHT = require('hyperdht')
    })

    describe('UsageTracker', () => {
        test('should initialize with half credits and regenerate over time', async () => {
            const tracker = p2pEngine.usageTracker
            const ip = '1.2.3.4'
            
            // Initial (50% of 5000MB = 2500MB)
            expect(tracker.getCredits(ip)).toBe(2500)

            // Consume some
            tracker.consume(ip, 500)
            expect(tracker.getCredits(ip)).toBeCloseTo(2000, 0)

            // Mock time passage for regen (0.5MB/s rate default)
            const entry = tracker.data.get(ip)
            entry.lastUpdate -= 10000 // 10 seconds ago
            
            // 2000 + (10 * 0.5) = 2005
            expect(tracker.getCredits(ip)).toBeCloseTo(2005, 0)
        })

        test('reserve and refund should work correctly', () => {
            const tracker = p2pEngine.usageTracker
            const ip = '1.2.3.4'

            expect(tracker.reserve(ip, 1000)).toBe(true)
            expect(tracker.getCredits(ip)).toBeCloseTo(1500, 0)

            tracker.refund(ip, 500)
            expect(tracker.getCredits(ip)).toBeCloseTo(2000, 0)

            expect(tracker.reserve(ip, 3000)).toBe(false)
            expect(tracker.getCredits(ip)).toBeCloseTo(2000, 0)
        })
    })

    describe('isLocalIP', () => {
        test('should detect IPv4 LAN ranges', () => {
            expect(p2pEngine.isLocalIP('192.168.1.1')).toBe(true)
            expect(p2pEngine.isLocalIP('10.0.0.5')).toBe(true)
            expect(p2pEngine.isLocalIP('172.16.0.1')).toBe(true)
            expect(p2pEngine.isLocalIP('127.0.0.1')).toBe(true)
            expect(p2pEngine.isLocalIP('8.8.8.8')).toBe(false)
        })

        test('should detect IPv6 local ranges', () => {
            expect(p2pEngine.isLocalIP('::1')).toBe(true)
            expect(p2pEngine.isLocalIP('fe80::1')).toBe(true)
            expect(p2pEngine.isLocalIP('::ffff:192.168.1.1')).toBe(true)
        })
    })

    describe('Engine Lifecycle', () => {
        test('start should initialize dht and swarm', async () => {
            await p2pEngine.start()
            expect(HyperDHT).toHaveBeenCalled()
            expect(Hyperswarm).toHaveBeenCalled()
            expect(p2pEngine.swarm).toBeDefined()
        })

        test('stop should cleanup resources', async () => {
            await p2pEngine.start()
            const swarm = p2pEngine.swarm
            await p2pEngine.stop()
            expect(swarm.destroy).toHaveBeenCalled()
            expect(p2pEngine.swarm).toBeNull()
        })
    })
})
