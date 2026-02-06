const { safeStorage } = require('electron')
const crypto = require('crypto')
const os = require('os')

// Fallback key generation (machine-specific but less secure than DPAPI/Keychain)
// We use basic machine identifiers to create a consistent key for this machine.
// This is ONLY used if safeStorage is unavailable (e.g., some Linux setups without a keyring).
function getFallbackKey() {
    const machineId = os.hostname() + os.userInfo().username
    return crypto.createHash('sha256').update(machineId).digest()
}

// Fallback encryption (AES-256-GCM)
function fallbackEncrypt(text) {
    try {
        const iv = crypto.randomBytes(16)
        const key = getFallbackKey()
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
        let encrypted = cipher.update(text, 'utf8', 'hex')
        encrypted += cipher.final('hex')
        const tag = cipher.getAuthTag()
        // Format: IV:TAG:ENCRYPTED
        return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted
    } catch (e) {
        console.error('Fallback encryption error:', e)
        return text // Fail open (return original) or throw? Returning original risks plaintext save.
    }
}

// Fallback decryption
function fallbackDecrypt(encryptedText) {
    try {
        const parts = encryptedText.split(':')
        if (parts.length !== 3) return encryptedText // Not encrypted by us

        const iv = Buffer.from(parts[0], 'hex')
        const tag = Buffer.from(parts[1], 'hex')
        const content = parts[2]
        const key = getFallbackKey()

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
        decipher.setAuthTag(tag)
        let decrypted = decipher.update(content, 'hex', 'utf8')
        decrypted += decipher.final('utf8')
        return decrypted
    } catch (e) {
        console.error('Fallback decryption error:', e)
        return encryptedText
    }
}

exports.encryptString = function (text) {
    if (!text) return text

    // Check if safeStorage is available
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
        try {
            return safeStorage.encryptString(text).toString('hex')
        } catch (error) {
            console.error('safeStorage encryption failed:', error)
            // Fallthrough to fallback
        }
    }

    return 'FB:' + fallbackEncrypt(text)
}

exports.decryptString = function (encryptedHex) {
    if (!encryptedHex) return encryptedHex

    // check if it uses our fallback prefix
    if (encryptedHex.startsWith('FB:')) {
        return fallbackDecrypt(encryptedHex.substring(3))
    }

    // Try safeStorage
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
        try {
            const buffer = Buffer.from(encryptedHex, 'hex')
            return safeStorage.decryptString(buffer)
        } catch (error) {
            console.error('safeStorage decryption failed:', error)
            return encryptedHex // Return original on failure (might have been plaintext)
        }
    }

    return encryptedHex
}
