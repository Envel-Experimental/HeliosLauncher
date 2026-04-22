const fs = require('fs')
const crypto = require('crypto')

describe('PeerPersistence', () => {
    let PeerPersistence

    beforeEach(() => {
        jest.resetModules()
        PeerPersistence = require('@network/PeerPersistence')
        
        // Mock fs.promises
        jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.alloc(0))
        jest.spyOn(fs.promises, 'writeFile').mockResolvedValue()
        jest.spyOn(fs.promises, 'rename').mockResolvedValue()
        jest.spyOn(fs.promises, 'unlink').mockResolvedValue()
        jest.spyOn(fs, 'existsSync').mockReturnValue(false)
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('should update and save peer', async () => {
        const peer = { ip: '1.2.3.4', port: 1234, score: 10 }
        await PeerPersistence.load()
        PeerPersistence.updatePeer('global', peer)
        
        expect(PeerPersistence.getPeers('global')).toHaveLength(1)
        expect(PeerPersistence.getPeers('global')[0].ip).toBe('1.2.3.4')
        expect(fs.promises.writeFile).toHaveBeenCalled()
    })

    test('should encrypt and decrypt correctly', async () => {
        const peer = { ip: '5.6.7.8', port: 8080 }
        await PeerPersistence.load()
        PeerPersistence.updatePeer('local', peer)
        
        let savedBuffer
        fs.promises.writeFile.mockImplementation((path, buffer) => {
            savedBuffer = buffer
            return Promise.resolve()
        })
        await PeerPersistence.save()
        
        fs.existsSync.mockReturnValue(true)
        fs.promises.readFile.mockResolvedValue(savedBuffer)
        
        // Reset state
        jest.resetModules()
        PeerPersistence = require('@network/PeerPersistence')
        
        await PeerPersistence.load()
        expect(PeerPersistence.getPeers('local')).toHaveLength(1)
        expect(PeerPersistence.getPeers('local')[0].ip).toBe('5.6.7.8')
    })

    test('should handle decryption failure by resetting cache', async () => {
        fs.existsSync.mockReturnValue(true)
        fs.promises.readFile.mockResolvedValue(Buffer.from('corrupt garbage'))
        const spy = jest.spyOn(console, 'error').mockImplementation()
        
        await PeerPersistence.load()
        expect(PeerPersistence.getPeers('local')).toHaveLength(0)
        expect(spy).toHaveBeenCalled()
        spy.mockRestore()
    })

    test('should prune expired peers', async () => {
        const now = Date.now()
        const oldPeer = { ip: 'old', port: 1, lastSeen: now - (20 * 24 * 60 * 60 * 1000) }
        const newPeer = { ip: 'new', port: 2, lastSeen: now }
        
        const data = JSON.stringify({ local: [oldPeer, newPeer], global: [] })
        const iv = crypto.randomBytes(16)
        const cipher = crypto.createCipheriv(PeerPersistence.algorithm, PeerPersistence._getKey(), iv)
        let encrypted = cipher.update(data)
        encrypted = Buffer.concat([encrypted, cipher.final()])
        const output = Buffer.concat([iv, encrypted])

        fs.existsSync.mockReturnValue(true)
        fs.promises.readFile.mockResolvedValue(output)
        
        await PeerPersistence.load()
        expect(PeerPersistence.getPeers('local')).toHaveLength(1)
        expect(PeerPersistence.getPeers('local')[0].ip).toBe('new')
    })
})
