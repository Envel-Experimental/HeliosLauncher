const { encryptString, decryptString } = require('@app/assets/js/core/util/SecurityUtils');
const { safeStorage } = require('electron');

// Mock electron's safeStorage
jest.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: jest.fn(),
    encryptString: jest.fn(),
    decryptString: jest.fn(),
  },
}));

describe('SecurityUtils', () => {
  const plainText = 'Hello World';
  const encryptedSafeStorage = 'aabbccdd'; // Simulated hex output from safeStorage
  const encryptedFallbackPrefix = 'FB:';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('encryptString', () => {
    it('should return the original string if input is empty', () => {
      expect(encryptString('')).toBe('');
      expect(encryptString(null)).toBe(null);
      expect(encryptString(undefined)).toBe(undefined);
    });

    it('should return the string if it starts with FB:', () => {
      const input = 'FB:someencrypteddata';
      expect(encryptString(input)).toBe(input);
    });

    it('should return the string if it looks like safeStorage hex (>64 chars)', () => {
      const longHex = 'a'.repeat(65);
      expect(encryptString(longHex)).toBe(longHex);
    });

    it('should use safeStorage if available', () => {
      safeStorage.isEncryptionAvailable.mockReturnValue(true);
      safeStorage.encryptString.mockReturnValue(Buffer.from(encryptedSafeStorage, 'hex'));

      const result = encryptString(plainText);

      expect(safeStorage.isEncryptionAvailable).toHaveBeenCalled();
      expect(safeStorage.encryptString).toHaveBeenCalledWith(plainText);
      expect(result).toBe(Buffer.from(encryptedSafeStorage, 'hex').toString('hex'));
    });

    it('should fall back if safeStorage throws error', () => {
      safeStorage.isEncryptionAvailable.mockReturnValue(true);
      safeStorage.encryptString.mockImplementation(() => {
        throw new Error('Encryption failed');
      });

      const result = encryptString(plainText);

      expect(safeStorage.encryptString).toHaveBeenCalled();
      expect(result.startsWith(encryptedFallbackPrefix)).toBe(true);
      // The result should contain IV:TAG:ENCRYPTED after FB:
      const parts = result.substring(3).split(':');
      expect(parts.length).toBe(3);
    });

    it('should use fallback if safeStorage is unavailable', () => {
      safeStorage.isEncryptionAvailable.mockReturnValue(false);

      const result = encryptString(plainText);

      expect(safeStorage.encryptString).not.toHaveBeenCalled();
      expect(result.startsWith(encryptedFallbackPrefix)).toBe(true);
      const parts = result.substring(3).split(':');
      expect(parts.length).toBe(3);
    });
  });

  describe('decryptString', () => {
    it('should return the original string if input is empty', () => {
      expect(decryptString('')).toBe('');
    });

    it('should use fallback decryption if string starts with FB:', () => {
      // First encrypt using fallback logic (by forcing unavailable)
      safeStorage.isEncryptionAvailable.mockReturnValue(false);
      const encrypted = encryptString(plainText);

      // Then decrypt
      const decrypted = decryptString(encrypted);
      expect(decrypted).toBe(plainText);
    });

    it('should return original string if fallback decryption fails (malformed)', () => {
      const malformed = 'FB:invalid:data';
      const decrypted = decryptString(malformed);
      expect(decrypted).toBe(malformed);
    });

    it('should use safeStorage decryption if string does not start with FB:', () => {
      safeStorage.isEncryptionAvailable.mockReturnValue(true);
      safeStorage.decryptString.mockReturnValue(plainText);

      const result = decryptString(encryptedSafeStorage);

      expect(safeStorage.decryptString).toHaveBeenCalledWith(Buffer.from(encryptedSafeStorage, 'hex'));
      expect(result).toBe(plainText);
    });

    it('should return original string if safeStorage decryption throws', () => {
        safeStorage.isEncryptionAvailable.mockReturnValue(true);
        safeStorage.decryptString.mockImplementation(() => {
            throw new Error('Decryption failed');
        });

        const result = decryptString(encryptedSafeStorage);
        expect(result).toBe(encryptedSafeStorage);
    });

    it('should return original string if safeStorage is unavailable', () => {
        safeStorage.isEncryptionAvailable.mockReturnValue(false);
        const result = decryptString(encryptedSafeStorage);
        expect(result).toBe(encryptedSafeStorage);
    });
  });
});
