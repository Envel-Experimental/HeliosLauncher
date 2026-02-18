const PeerHandler = require('../../network/PeerHandler')
const ConfigManager = require('../../app/assets/js/configmanager')
const path = require('path')

// Mock ConfigManager
jest.mock('../../app/assets/js/configmanager', () => {
    const path = require('path')
    return {
        getDataDirectory: jest.fn(() => path.resolve('/game/data')),
        getCommonDirectory: jest.fn(() => path.resolve('/game/common')),
        getP2PUploadEnabled: jest.fn(),
        getLocalOptimization: jest.fn(),
        getP2PUploadLimit: jest.fn(),
        getLauncherDirectory: jest.fn(() => path.resolve('/game/launcher'))
    }
})

describe('PeerHandler Security', () => {
    let mockSocket
    let mockEngine
    let peerHandler

    beforeAll(() => {
        // Mock values are now set in the factory above
    })

    test('_isPathSecure blocks traversal to config.js', () => {
        // Access via prototype to avoid constructor complexity
        const isPathSecure = PeerHandler.prototype._isPathSecure

        const commonDir = path.resolve('/game/common')
        // Attack vector: assets/../../config.js
        // The checking logic tries to resolve this relative to roots.

        // Scenario 1: Malicious path trying to escape
        // We simulate what path.resolve does if we joined it? 
        // No, the method takes an already resolved/absolute path (mostly) or we pass what we want to test.
        // Wait, looking at usage in PeerHandler.js:
        // candidates.push(path.resolve(path.join(commonDir, 'assets', ...)))
        // So the input to _isPathSecure is an ABSOLUTE path.

        // So if the input is path.resolve('/game/common/assets/../../config.js')
        // output is path.resolve('/game/config.js')

        const attackPath = path.resolve(commonDir, 'assets/../../config.js')

        // The implementation checks:
        // 1. Is it inside dataDir or commonDir?
        // 2. Is the relative path start with '..'?
        // 3. Whitelist/Blacklist

        const result = isPathSecure(attackPath)
        expect(result).toBe(false)
    })

    test('_isPathSecure allows valid assets', () => {
        const isPathSecure = PeerHandler.prototype._isPathSecure
        const commonDir = path.resolve('/game/common')

        const validPath = path.resolve(commonDir, 'assets/objects/abc/hash')
        expect(isPathSecure(validPath)).toBe(true)
    })

    test('_isPathSecure blocks strict blacklist files', () => {
        const isPathSecure = PeerHandler.prototype._isPathSecure
        const dataDir = path.resolve('/game/data')

        // options.txt is blacklisted
        const blockedPath = path.resolve(dataDir, 'options.txt')
        expect(isPathSecure(blockedPath)).toBe(false)
    })

    test('_isPathSecure blocks strict extension blacklist', () => {
        const isPathSecure = PeerHandler.prototype._isPathSecure
        const dataDir = path.resolve('/game/data')

        const blockedPath = path.resolve(dataDir, 'launcher.log')
        expect(isPathSecure(blockedPath)).toBe(false)
    })

    test('_isPathSecure blocks paths outside roots', () => {
        const isPathSecure = PeerHandler.prototype._isPathSecure

        // Some random path on system
        const systemPath = path.resolve('/etc/passwd')
        expect(isPathSecure(systemPath)).toBe(false)
    })

    test('_isPathSecure blocks traversal attempts explicitly if they remain resolved as inside but logic catches them', () => {
        // This is tricky. path.resolve resolves the .. so path is clean.
        // 'assets/../../config.js' -> '/config.js' (relative to root /game/common) -> '/game/common/config.js' ?
        // No, 'assets/../../config.js' is 'config.js'. 
        // path.join('/game/common', 'assets/../../config.js') -> '/game/common/config.js'
        // If config.js is in /game/common, is it allowed?
        // Strict whitelist: 'assets', 'libraries' implies top folder must be one of them.
        // 'config.js' is top level file. 
        // relCommon is 'config.js'. parts[0] is 'config.js'.
        // whitelist does NOT include 'config.js'.

        const isPathSecure = PeerHandler.prototype._isPathSecure
        const commonDir = path.resolve('/game/common')

        const p = path.join(commonDir, 'assets', '../..', 'config.js')
        // effectively /game/common/config.js

        expect(isPathSecure(p)).toBe(false)
    })
})
