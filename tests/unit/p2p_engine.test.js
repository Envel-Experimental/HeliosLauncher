const path = require('path')

describe('P2PEngine Unit Tests', () => {
    let engine;
    let Hyperswarm;
    let HyperDHT;

    beforeEach(() => {
        jest.resetModules()

        // Mock ConfigManager
        // Correct path: tests/unit/p2p_engine.test.js -> core/configmanager
        jest.mock('../../app/assets/js/core/configmanager', () => ({
            isLoaded: () => true,
            getSettings: () => ({
                deliveryOptimization: {
                    globalOptimization: true,
                    localOptimization: true,
                    p2pUploadEnabled: true,
                    p2pOnlyMode: false
                }
            }),
            getGlobalOptimization: () => true,
            getP2PUploadEnabled: () => true,
            getLocalOptimization: () => true,
            getP2POnlyMode: () => false,
            getDataDirectory: () => path.resolve(__dirname, '../../test_data'),
            getCommonDirectory: () => path.resolve(__dirname, '../../test_data/common'),
            getCommonDirectorySync: () => path.resolve(__dirname, '../../test_data/common'),
            getP2PUploadLimit: () => 15,
            getLauncherDirectory: () => path.resolve(__dirname, '../../test_data/launcher'),
            getLauncherDirectorySync: () => path.resolve(__dirname, '../../test_data/launcher')
        }))

        // Mock Hyperswarm
        jest.mock('hyperswarm', () => {
            return jest.fn().mockImplementation(() => {
                const ee = new (require('events').EventEmitter)()
                ee.join = jest.fn().mockReturnValue({
                    flushed: jest.fn().mockResolvedValue(),
                    destroy: jest.fn().mockResolvedValue()
                })
                ee.flush = jest.fn().mockResolvedValue()
                ee.destroy = jest.fn().mockResolvedValue()
                ee.discovery = {
                    on: jest.fn(),
                    destroy: jest.fn()
                }
                return ee
            })
        })

        // Mock HyperDHT
        jest.mock('hyperdht', () => {
            return jest.fn().mockImplementation(() => {
                const ee = new (require('events').EventEmitter)()
                ee.destroy = jest.fn().mockResolvedValue()
                return ee
            })
        })

        engine = require('../../network/P2PEngine')
        Hyperswarm = require('hyperswarm')
        HyperDHT = require('hyperdht')
    })

    afterEach(async () => {
        if (engine && typeof engine.stop === 'function') {
            await engine.stop()
        }
        jest.clearAllMocks()
    })

    test('Engine should initialize with HyperDHT and Hyperswarm', async () => {
        await engine.start()
        
        expect(engine.dht).toBeDefined()
        expect(engine.swarm).toBeDefined()
        expect(engine.starting).toBe(false)
        
        // Check if topic is joined
        expect(engine.swarm.join).toHaveBeenCalled()
    })
})
