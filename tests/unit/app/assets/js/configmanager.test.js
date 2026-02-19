const fs = require('fs/promises');
const path = require('path');

// Mock fs/promises
jest.mock('fs/promises', () => ({
  stat: jest.fn(),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  readFile: jest.fn(),
  rename: jest.fn(),
}));

// Mock util
jest.mock('@app/assets/js/util', () => ({
  move: jest.fn(),
  retry: jest.fn((fn) => fn()),
  safeWriteJson: jest.fn(),
  safeReadJson: jest.fn()
}));

// Mock SecurityUtils
jest.mock('@app/assets/js/core/util/SecurityUtils', () => ({
  encryptString: jest.fn((str) => `ENC:${str}`),
  decryptString: jest.fn((str) => str.startsWith('ENC:') ? str.substring(4) : str),
}));

// Mock electron
jest.mock('electron', () => ({
  app: {
      getPath: jest.fn(() => '/mock/user/data'),
      getName: jest.fn(() => 'FLauncher'),
  }
}));

jest.mock('@electron/remote', () => ({
  app: {
      getPath: jest.fn(() => '/mock/user/data'),
      getName: jest.fn(() => 'FLauncher'),
  }
}));

// Mock LoggerUtil
jest.mock('@app/assets/js/core/util/LoggerUtil', () => ({
    LoggerUtil: {
        getLogger: jest.fn(() => ({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        }))
    }
}));

// Mock pathutil to avoid file system operations during require
jest.mock('@app/assets/js/pathutil', () => ({
    resolveDataPathSync: jest.fn(() => '/mock/data/path'),
    isPathValid: jest.fn(() => true),
    getTempNativeFolder: jest.fn(() => 'temp_natives'),
    resolveDataPath: jest.fn(() => Promise.resolve('/mock/data/path')),
}));


const ConfigManager = require('@app/assets/js/configmanager');
const { safeWriteJson, safeReadJson, move } = require('@app/assets/js/util');
const SecurityUtils = require('@app/assets/js/core/util/SecurityUtils');

describe('ConfigManager', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('load()', () => {
    it('should create default config on first launch (no config files)', async () => {
      fs.stat.mockRejectedValue({ code: 'ENOENT' }); // Neither config exists

      await ConfigManager.load();

      expect(fs.mkdir).toHaveBeenCalled();
      expect(safeWriteJson).toHaveBeenCalled(); // Saves default
      expect(ConfigManager.isFirstLaunch()).toBe(true);
    });

    it('should migrate legacy config if present', async () => {
        // config.json missing, legacy exists
        fs.stat.mockImplementation((p) => {
            if (p.includes('/mock/user/data')) return Promise.resolve({});
            return Promise.reject({ code: 'ENOENT' });
        });
        // Mock safeReadJson to return valid config after migration
        safeReadJson.mockResolvedValue({ settings: {} });

        await ConfigManager.load();

        expect(move).toHaveBeenCalled();
        expect(ConfigManager.isFirstLaunch()).toBe(false);
    });

    it('should load and decrypt existing config', async () => {
        fs.stat.mockResolvedValue({}); // Exists
        const mockConfig = {
            settings: { game: { resWidth: 800 } },
            clientToken: 'ENC:token123',
            authenticationDatabase: {
                'uuid1': {
                    accessToken: 'ENC:access123',
                    microsoft: {
                        access_token: 'ENC:msAccess',
                        refresh_token: 'ENC:msRefresh'
                    }
                }
            }
        };
        safeReadJson.mockResolvedValue(mockConfig);

        await ConfigManager.load();

        expect(ConfigManager.getGameWidth()).toBe(800);
        expect(ConfigManager.getClientToken()).toBe('token123'); // Decrypted
        const acc = ConfigManager.getAuthAccount('uuid1');
        expect(acc.accessToken).toBe('access123');
        expect(acc.microsoft.access_token).toBe('msAccess');
    });
  });

  describe('save()', () => {
      it('should encrypt sensitive data before saving', async () => {
          // Ensure loaded
          fs.stat.mockResolvedValue({});
          safeReadJson.mockResolvedValue({
              authenticationDatabase: {},
              settings: { launcher: { dataDirectory: 'data' } }
          });
          await ConfigManager.load();

          // Clear mocks to ignore the save() call inside load()
          safeWriteJson.mockClear();

          // Set sensitive data
          ConfigManager.setClientToken('secretToken');
          ConfigManager.addMojangAuthAccount('uuid2', 'accessTokenRaw', 'user', 'Display');

          await ConfigManager.save();

          expect(safeWriteJson).toHaveBeenCalled();
          const callArgs = safeWriteJson.mock.calls[0];
          const savedData = callArgs[1];

          expect(savedData.clientToken).toBe('ENC:secretToken');
          expect(savedData.authenticationDatabase['uuid2'].accessToken).toBe('ENC:accessTokenRaw');
      });
  });

  describe('Getters and Setters', () => {
      it('should get and set game dimensions', () => {
          ConfigManager.setGameWidth(1024);
          expect(ConfigManager.getGameWidth()).toBe(1024);
          ConfigManager.setGameHeight(768);
          expect(ConfigManager.getGameHeight()).toBe(768);
      });

      it('should validate game dimensions', () => {
          expect(ConfigManager.validateGameWidth(100)).toBe(true);
          expect(ConfigManager.validateGameWidth(-1)).toBe(false);
          expect(ConfigManager.validateGameWidth('abc')).toBe(false);
      });

      it('should manage auth accounts', () => {
          ConfigManager.addMojangAuthAccount('uuid3', 'token', 'user', 'display');
          expect(ConfigManager.getAuthAccount('uuid3')).toBeDefined();

          const acc = ConfigManager.getSelectedAccount();
          expect(acc.uuid).toBe('uuid3');

          ConfigManager.removeAuthAccount('uuid3');
          expect(ConfigManager.getAuthAccount('uuid3')).toBeUndefined();
      });

      it('should manage mod configurations', () => {
          const config = { id: 'server1', mods: [] };
          ConfigManager.setModConfiguration('server1', config);
          expect(ConfigManager.getModConfiguration('server1')).toBe(config);
      });

      it('should manage java config', () => {
          ConfigManager.ensureJavaConfig('server1', { suggestedMajor: 8 }, {});
          expect(ConfigManager.getMinRAM('server1')).toBeDefined();

          ConfigManager.setMinRAM('server1', '4G');
          expect(ConfigManager.getMinRAM('server1')).toBe('4G');
      });
  });
});
