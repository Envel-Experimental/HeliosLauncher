// Mock Dependencies
jest.mock('hyperswarm', () => {
    return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        join: jest.fn().mockReturnValue({
            flushed: jest.fn().mockResolvedValue(true),
            destroy: jest.fn()
        }),
        destroy: jest.fn().mockResolvedValue(true)
    }))
})
jest.mock('hyperdht')
jest.mock('b4a', () => ({
    from: jest.fn(v => Buffer.from(v)),
    isBuffer: jest.fn(v => Buffer.isBuffer(v)),
    toString: jest.fn(v => Buffer.isBuffer(v) ? v.toString('hex') : ''),
    allocUnsafe: jest.fn(size => Buffer.allocUnsafe(size)),
    allocUnsafeSlow: jest.fn(size => Buffer.allocUnsafe(size)),
    alloc: jest.fn(size => Buffer.alloc(size)),
    fill: jest.fn((buf, val) => buf.fill(val)),
    subarray: jest.fn((buf, start, end) => buf.subarray(start, end)),
    equals: jest.fn((a, b) => a.equals(b))
}))
jest.mock('sodium-native', () => ({
    crypto_sign_SEEDBYTES: 32,
    crypto_sign_PUBLICKEYBYTES: 32,
    crypto_sign_SECRETKEYBYTES: 64,
    crypto_sign_BYTES: 64,
    crypto_box_PUBLICKEYBYTES: 32,
    crypto_box_SECRETKEYBYTES: 32,
    crypto_box_SEALBYTES: 48,
    crypto_sign_keypair: jest.fn((pk, sk) => {
        pk.fill(0)
        sk.fill(0)
    }),
    randombytes_buf: jest.fn(),
    crypto_generichash: jest.fn(),
    crypto_generichash_batch: jest.fn()
}))

// Mock ConfigManager
jest.mock('../../../app/assets/js/core/configmanager', () => ({
    getSettings: jest.fn(() => ({
        deliveryOptimization: {
            globalOptimization: true,
            localOptimization: true,
            p2pUploadEnabled: true
        }
    })),
    getP2PUploadLimit: jest.fn(() => 15),
    getP2PUploadEnabled: jest.fn(() => true),
    getLocalOptimization: jest.fn(() => true),
    isLoaded: jest.fn(() => true),
    getLauncherDirectorySync: jest.fn(() => '/appdata/launcher'),
    getCommonDirectorySync: jest.fn(() => '/appdata/common'),
    getSelectedAccount: jest.fn(() => ({ uuid: 'test-uuid' })),
    save: jest.fn().mockResolvedValue(true)
}))

jest.mock('../../../network/PeerPersistence', () => {
    return {
        load: jest.fn().mockResolvedValue(true),
        getPeers: jest.fn().mockReturnValue([]),
        addPeer: jest.fn(),
        save: jest.fn()
    }
})
jest.mock('../../../network/NodeAdapter', () => ({
    isCritical: jest.fn().mockReturnValue(false),
    getProfile: jest.fn().mockReturnValue({ name: 'HIGH', passive: false })
}))

const Hyperswarm = require('hyperswarm')
const HyperDHT = require('hyperdht')
const ConfigManager = require('../../../app/assets/js/core/configmanager')
const crypto = require('crypto')

describe('P2PEngine HyperDHT Integration', () => {
    let engine

    beforeEach(() => {
        jest.clearAllMocks()
        
        // Mock HyperDHT constructor and methods
        HyperDHT.prototype.on = jest.fn()
        HyperDHT.prototype.destroy = jest.fn().mockResolvedValue(true)
        HyperDHT.prototype._getRoutingTableSize = jest.fn().mockReturnValue(0)
        
        // Require fresh instance
        jest.isolateModules(() => {
            engine = require('../../../network/P2PEngine')
        })
    })

    afterEach(async () => {
        if (engine && typeof engine.stop === 'function') await engine.stop()
    })

    test('should join swarm with correct topic', async () => {
        await engine.start()

        const { SWARM_TOPIC_SEED } = require('../../../network/constants')
        const expectedTopic = crypto.createHash('sha256').update(SWARM_TOPIC_SEED).digest()

        // Get the mock instance of Hyperswarm
        const mockSwarmInstance = Hyperswarm.mock.results[0].value

        expect(mockSwarmInstance.join).toHaveBeenCalledWith(
            expectedTopic,
            expect.objectContaining({
                server: true,
                client: true
            })
        )
    })
})
