const crypto = require('crypto')

// Mock Electron
const mockSafeStorage = {
    isEncryptionAvailable: jest.fn().mockReturnValue(true),
    encryptString: jest.fn(s => Buffer.from(s + '_enc')),
    decryptString: jest.fn(b => b.toString().replace('_enc', ''))
}

jest.mock('electron', () => ({
    safeStorage: mockSafeStorage
}))

// Mock OS
jest.mock('os', () => ({
    hostname: jest.fn().mockReturnValue('mock-host'),
    userInfo: jest.fn().mockReturnValue({ username: 'mock-user' })
}))

// We need to temporarily disable the test mode bypass inside the module
const SecurityUtils = require('../../../../app/assets/js/core/util/SecurityUtils')

describe('SecurityUtils', () => {
    
    beforeEach(() => {
        jest.clearAllMocks()
        // Override NODE_ENV for these tests to bypass the 'test' mode check
        delete process.env.NODE_ENV
    })

    afterEach(() => {
        process.env.NODE_ENV = 'test'
    })

    it('should encrypt and decrypt using safeStorage', () => {
        const secret = 'my-secret'
        const encrypted = SecurityUtils.encryptString(secret)
        expect(encrypted).toBeDefined()
        expect(mockSafeStorage.encryptString).toHaveBeenCalledWith(secret)

        const decrypted = SecurityUtils.decryptString(encrypted)
        expect(decrypted).toBe(secret)
    })

    it('should use fallback encryption if safeStorage fails', () => {
        mockSafeStorage.encryptString.mockImplementationOnce(() => { throw new Error('fail') })
        
        const secret = 'fallback-secret'
        const encrypted = SecurityUtils.encryptString(secret)
        expect(encrypted.startsWith('FB:')).toBe(true)

        const decrypted = SecurityUtils.decryptString(encrypted)
        expect(decrypted).toBe(secret)
    })

    it('should handle double encryption prevention', () => {
        const encrypted = 'FB:iv:tag:data'
        const reEncrypted = SecurityUtils.encryptString(encrypted)
        expect(reEncrypted).toBe(encrypted)
    })

    it('should return null on safeStorage decryption failure', () => {
        mockSafeStorage.decryptString.mockImplementationOnce(() => { throw new Error('fail') })
        const decrypted = SecurityUtils.decryptString('abcdef123456')
        expect(decrypted).toBeNull()
    })
})
