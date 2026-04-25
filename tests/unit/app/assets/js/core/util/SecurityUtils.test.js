jest.mock('electron', () => ({
    safeStorage: {
        isEncryptionAvailable: jest.fn(),
        encryptString: jest.fn(),
        decryptString: jest.fn()
    }
}))

const SecurityUtils = require('../../../../../../../app/assets/js/core/util/SecurityUtils')
const { safeStorage } = require('electron')

describe('SecurityUtils', () => {
    const originalEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.resetAllMocks()
        process.env.NODE_ENV = 'production' // Set to production to avoid bypass
    })

    afterAll(() => {
        process.env.NODE_ENV = originalEnv
    })

    describe('encryptString', () => {
        it('should use safeStorage when available', () => {
            safeStorage.isEncryptionAvailable.mockReturnValue(true)
            safeStorage.encryptString.mockReturnValue(Buffer.from('encrypted'))

            const result = SecurityUtils.encryptString('secret')
            expect(result).toBe(Buffer.from('encrypted').toString('hex'))
            expect(safeStorage.encryptString).toHaveBeenCalledWith('secret')
        })

        it('should use fallback when safeStorage fails', () => {
            safeStorage.isEncryptionAvailable.mockReturnValue(true)
            safeStorage.encryptString.mockImplementation(() => { throw new Error('fail') })

            const result = SecurityUtils.encryptString('secret')
            expect(result).toMatch(/^FB:/)
        })

        it('should return original for empty input', () => {
            expect(SecurityUtils.encryptString('')).toBe('')
            expect(SecurityUtils.encryptString(null)).toBe(null)
        })

        it('should bypass encryption in test mode', () => {
            process.env.NODE_ENV = 'test'
            expect(SecurityUtils.encryptString('secret')).toBe('secret')
        })
    })

    describe('decryptString', () => {
        it('should use safeStorage when available', () => {
            safeStorage.isEncryptionAvailable.mockReturnValue(true)
            safeStorage.decryptString.mockReturnValue('secret')

            // Use a 32-char hex string to pass validation
            const result = SecurityUtils.decryptString('0123456789abcdef0123456789abcdef')
            expect(result).toBe('secret')
        })

        it('should handle FB: prefix for fallback decryption', () => {
            const encrypted = SecurityUtils.encryptString('secret')
            // If encrypted starts with FB: (when safeStorage disabled)
            if (encrypted.startsWith('FB:')) {
                const decrypted = SecurityUtils.decryptString(encrypted)
                expect(decrypted).toBe('secret')
            }
        })

        it('should return null if safeStorage decryption fails', () => {
            safeStorage.isEncryptionAvailable.mockReturnValue(true)
            safeStorage.decryptString.mockImplementation(() => { throw new Error('fail') })

            // Use a 32-char hex string to pass validation
            const result = SecurityUtils.decryptString('0123456789abcdef0123456789abcdef')
            expect(result).toBeNull()
        })
    })
})
