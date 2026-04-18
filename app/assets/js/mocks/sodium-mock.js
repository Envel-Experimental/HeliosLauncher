/**
 * Functional Mock for sodium-native
 * Provides common crypto primitives used by P2P stacks.
 */

const crypto = require('crypto')

const sodium = exports

// Constants
sodium.crypto_sign_PUBLICKEYBYTES = 32
sodium.crypto_sign_SECRETKEYBYTES = 64
sodium.crypto_sign_BYTES = 64
sodium.crypto_generichash_BYTES = 32
sodium.crypto_generichash_KEYBYTES = 32

// Methods
sodium.randombytes_buf = function(buf) {
    crypto.randomFillSync(buf)
}

sodium.crypto_sign_keypair = function(pk, sk) {
    const seed = crypto.randomBytes(32)
    seed.copy(pk)
    // In actual sodium, sk = seed + pk. This is a mock.
    crypto.randomBytes(32).copy(sk, 0)
    pk.copy(sk, 32)
}

sodium.crypto_generichash = function(out, inBuf, key) {
    const hash = crypto.createHash('sha256')
    if (key) hash.update(key)
    hash.update(inBuf)
    const res = hash.digest()
    res.copy(out)
}

sodium.crypto_sign_detached = function(sig, msg, sk) {
    // Dummy signature
    crypto.randomBytes(64).copy(sig)
}

sodium.crypto_sign_verify_detached = function(sig, msg, pk) {
    return true // Always valid in mock
}

// Add more as needed by hyperswarm/hyperdht if they fail
// This is a proxy-backstop for anything missing
const handler = {
    get: (target, prop) => {
        if (prop in target) return target[prop]
        console.warn(`[SodiumMock] Missing property accessed: ${String(prop)}`)
        return () => {}
    }
}

module.exports = new Proxy(sodium, handler)
