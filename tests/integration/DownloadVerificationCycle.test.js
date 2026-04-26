const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')
const http = require('http')
const { downloadFile } = require('../../app/assets/js/core/dl/DownloadEngine')
const { DISTRO_PUB_KEYS } = require('../../network/config')

describe('Real-World Download Verification Cycle', () => {
    let testDir
    let publicKeyHex
    let privateKey
    let server
    let serverPort
    let responseData = {}

    beforeAll(async () => {
        testDir = path.join(__dirname, `tmp_real_dl_test_${Date.now()}_${Math.floor(Math.random() * 1000)}`)
        await fs.mkdir(testDir, { recursive: true })

        // 1. Generate real Ed25519 keypair
        const { publicKey, privateKey: priv } = crypto.generateKeyPairSync('ed25519')
        privateKey = priv
        const exported = publicKey.export({ type: 'spki', format: 'der' })
        publicKeyHex = exported.slice(12).toString('hex')

        // 2. Setup a real local HTTP server
        server = http.createServer((req, res) => {
            if (responseData[req.url]) {
                res.writeHead(200, { 
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': responseData[req.url].length
                })
                res.end(responseData[req.url])
            } else {
                res.writeHead(404)
                res.end()
            }
        })
        
        await new Promise(resolve => server.listen(0, '127.0.0.1', () => {
            serverPort = server.address().port
            resolve()
        }))

        // 3. Setup IPC Bridge Mock
        global.window = {
            HeliosAPI: {
                ipc: {
                    invoke: async (channel, data) => {
                        if (channel === 'crypto:verifyDistribution') {
                            const { dataHex, signatureHex, trustedKeys } = data
                            for (const keyHex of trustedKeys) {
                                try {
                                    const spkiBuffer = Buffer.concat([
                                        Buffer.from('302a300506032b6570032100', 'hex'),
                                        Buffer.from(keyHex, 'hex')
                                    ])
                                    const publicKeyObj = crypto.createPublicKey({ key: spkiBuffer, format: 'der', type: 'spki' })
                                    const isValid = crypto.verify(null, Buffer.from(dataHex, 'hex'), publicKeyObj, Buffer.from(signatureHex, 'hex'))
                                    if (isValid) return true
                                } catch (e) {}
                            }
                            return false
                        }
                    }
                }
            },
            ipcRenderer: {
                invoke: (...args) => global.window.HeliosAPI.ipc.invoke(...args)
            }
        }
        process.type = 'renderer'

        // 4. Mock dependencies
        const ConfigManager = require('../../app/assets/js/core/configmanager')
        ConfigManager.getNoServers = jest.fn().mockReturnValue(false)
        ConfigManager.getP2POnlyMode = jest.fn().mockReturnValue(false)
        ConfigManager.fetchWithTimeout = async (url, opts) => {
            return await fetch(url, opts)
        }
        
        const MirrorManager = require('../../network/MirrorManager')
        jest.spyOn(MirrorManager, 'isMirrorUrl').mockReturnValue(true)
        jest.spyOn(MirrorManager, 'reportFailure').mockImplementation(() => {})
    })

    afterAll(async () => {
        await new Promise(resolve => server.close(resolve))
        delete global.window
        delete process.type

        // Robust cleanup for Windows
        for (let i = 0; i < 5; i++) {
            try {
                await fs.rm(testDir, { recursive: true, force: true })
                break
            } catch (e) {
                if (i === 4) console.warn('Cleanup failed after 5 attempts:', e.message)
                await new Promise(r => setTimeout(r, 200))
            }
        }
    })

    it('should successfully download and VERIFY a file over real HTTP', async () => {
        const content = Buffer.from('this is a test file content for signature verification')
        const signature = crypto.sign(null, content, privateKey).toString('hex')
        const sha1 = crypto.createHash('sha1').update(content).digest('hex')

        responseData['/test.file'] = content
        responseData['/test.file.sig'] = Buffer.from(signature)

        const finalPath = path.join(testDir, 'verified_test.file')
        const asset = {
            id: 'real_test_file',
            path: finalPath,
            url: `http://127.0.0.1:${serverPort}/test.file`,
            algo: 'sha1',
            hash: sha1,
            size: content.length,
            verifySignature: true
        }

        const originalKeys = [...DISTRO_PUB_KEYS]
        DISTRO_PUB_KEYS.length = 0
        DISTRO_PUB_KEYS.push(publicKeyHex)

        try {
            await downloadFile(asset, () => {})
        } finally {
            DISTRO_PUB_KEYS.length = 0
            DISTRO_PUB_KEYS.push(...originalKeys)
        }

        const savedContent = await fs.readFile(finalPath)
        expect(savedContent.toString()).toBe(content.toString())
    }, 15000)

    it('should REJECT and delete file on bad signature over real HTTP', async () => {
        const content = Buffer.from('bad file content')
        const badSignature = '0'.repeat(128)
        const sha1 = crypto.createHash('sha1').update(content).digest('hex')

        responseData['/bad.file'] = content
        responseData['/bad.file.sig'] = Buffer.from(badSignature)

        const finalPath = path.join(testDir, 'bad_verified.file')
        const asset = {
            id: 'bad_test_file',
            path: finalPath,
            url: `http://127.0.0.1:${serverPort}/bad.file`,
            algo: 'sha1',
            hash: sha1,
            size: content.length,
            verifySignature: true,
            maxAttempts: 1
        }

        const originalKeys = [...DISTRO_PUB_KEYS]
        DISTRO_PUB_KEYS.length = 0
        DISTRO_PUB_KEYS.push(publicKeyHex)

        try {
            await expect(downloadFile(asset, () => {})).rejects.toThrow()
        } finally {
            DISTRO_PUB_KEYS.length = 0
            DISTRO_PUB_KEYS.push(...originalKeys)
        }

        const exists = await fs.access(finalPath).then(() => true).catch(() => false)
        const tempExists = await fs.access(finalPath + '.tmp').then(() => true).catch(() => false)
        expect(exists).toBe(false)
        expect(tempExists).toBe(false)
    }, 15000)
})
