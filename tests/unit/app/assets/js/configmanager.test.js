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

// Mock util.move
jest.mock('@app/assets/js/util', () => ({
  move: jest.fn(),
  retry: jest.fn((fn) => fn()),
  safeWriteJson: jest.fn(),
  safeReadJson: jest.fn()
}));

// Mock sysutil (since ConfigManager might import it or things that depend on it)
jest.mock('@app/assets/js/sysutil', () => ({
  // add any necessary mocks
}));


const ConfigManager = require('@app/assets/js/configmanager');
const fsPromises = require('fs/promises');
const { move, safeWriteJson, safeReadJson } = require('@app/assets/js/util');

describe('ConfigManager', () => {

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  it('should be an object', () => {
    expect(typeof ConfigManager).toBe('object');
  });

  describe('load()', () => {
    it('should create a default config if one does not exist', async () => {
      // Mock existance check (stat) to throw ENOENT
      fsPromises.stat.mockRejectedValue({ code: 'ENOENT' });

      await ConfigManager.load();

      // Should try to write default config
      expect(safeWriteJson).toHaveBeenCalled();
    });

    it('should load an existing config file', async () => {
      // Mock stat to succeed (file exists)
      fsPromises.stat.mockResolvedValue({ isFile: () => true });
      safeReadJson.mockResolvedValue({ settings: { game: { resWidth: 1920 } } });

      await ConfigManager.load();
      expect(ConfigManager.getGameWidth()).toBe(1920);
    });

    it('should handle a corrupt config file', async () => {
      fsPromises.stat.mockResolvedValue({ isFile: () => true });
      safeReadJson.mockRejectedValue(new SyntaxError('Unexpected token'));

      await ConfigManager.load();

      // Should catch the error and re-save default config
      expect(safeWriteJson).toHaveBeenCalled();
      expect(ConfigManager.getGameWidth()).toBe(1280); // Default value
    });
  });

  describe('save()', () => {
    it('should save the current config to a file', async () => {
      // Setup initial load
      fsPromises.stat.mockRejectedValue({ code: 'ENOENT' });
      await ConfigManager.load();

      ConfigManager.setGameWidth(1920);
      await ConfigManager.save();

      // save() calls safeWriteJson
      // Expect safeWriteJson to be called with updated config
      // safeWriteJson(path, data)
      const saveArgs = safeWriteJson.mock.calls;
      const savedData = saveArgs[saveArgs.length - 1][1];
      expect(savedData.settings.game.resWidth).toBe(1920);
    });
  });

});
