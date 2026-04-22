const crypto = require('crypto')
const SignatureUtils = require('../../../../app/assets/js/core/util/SignatureUtils')

describe('SignatureUtils', () => {
    
    let privateKey, publicKeyHex
    const testData = 'hello world'
    const testDataHex = Buffer.from(testData).toString('hex')

    beforeAll(() => {
        // Generate a real Ed25519 key pair for testing
        const { publicKey, privateKey: priv } = crypto.generateKeyPairSync('ed25519')
        privateKey = priv
        // Extract raw public key bytes (32 bytes)
        // SPKI for Ed25519 is 44 bytes, last 32 are the key
        const spki = publicKey.export({ format: 'der', type: 'spki' })
        publicKeyHex = spki.subarray(spki.length - 32).toString('hex')
    })

    it('should verify valid signature', () => {
        const signature = crypto.sign(null, Buffer.from(testData), privateKey)
        const signatureHex = signature.toString('hex')

        const isValid = SignatureUtils.verifyDistribution({
            dataHex: testDataHex,
            signatureHex,
            trustedKeys: [publicKeyHex]
        })

        expect(isValid).toBe(true)
    })

    it('should fail on invalid signature', () => {
        const isValid = SignatureUtils.verifyDistribution({
            dataHex: testDataHex,
            signatureHex: '00'.repeat(64),
            trustedKeys: [publicKeyHex]
        })

        expect(isValid).toBe(false)
    })

    it('should fail on untrusted key', () => {
        const signature = crypto.sign(null, Buffer.from(testData), privateKey)
        const signatureHex = signature.toString('hex')
        const otherKeyHex = '00'.repeat(32)

        const isValid = SignatureUtils.verifyDistribution({
            dataHex: testDataHex,
            signatureHex,
            trustedKeys: [otherKeyHex]
        })

        expect(isValid).toBe(false)
    })

    it('should handle malformed data', () => {
        const isValid = SignatureUtils.verifyDistribution({
            dataHex: 'not-hex',
            signatureHex: 'not-hex',
            trustedKeys: [publicKeyHex]
        })
        expect(isValid).toBe(false)
    })
})
