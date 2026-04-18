const crypto = require('crypto')

/**
 * Verifies the signature of the distribution data using the provided trusted keys.
 * 
 * @param {Object} params
 * @param {string} params.dataHex Hex encoded data buffer
 * @param {string} params.signatureHex Hex encoded signature
 * @param {string[]} params.trustedKeys Array of trusted public keys in hex
 * @returns {boolean} True if signature is valid, otherwise false.
 */
function verifyDistribution({ dataHex, signatureHex, trustedKeys }) {
    try {
        const contentBuffer = Buffer.from(dataHex, 'hex')
        const signature = Buffer.from(signatureHex, 'hex')
        const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

        for (const keyHex of trustedKeys) {
            try {
                const rawKey = Buffer.from(keyHex, 'hex')
                const spkiKey = Buffer.concat([ED25519_SPKI_PREFIX, rawKey])
                const publicKey = crypto.createPublicKey({
                    key: spkiKey,
                    format: 'der',
                    type: 'spki'
                })

                if (crypto.verify(null, contentBuffer, publicKey, signature)) {
                    return true
                }
            } catch (e) {
                // Key check failed, try next
            }
        }
    } catch (err) {
        console.error('[SignatureUtils] Signature verification logic failure:', err)
    }
    return false
}

module.exports = {
    verifyDistribution
}
