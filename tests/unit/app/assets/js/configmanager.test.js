const fs = require('fs-extra');
const os = require('os');
const path = require('path');

// Mock fs-extra
jest.mock('fs-extra', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  ensureDirSync: jest.fn(),
  moveSync: jest.fn(),
}));

const ConfigManager = require('@app/assets/js/configmanager');

describe('ConfigManager', () => {

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  it('should be an object', () => {
    expect(typeof ConfigManager).toBe('object');
  });

  describe('load()', () => {
    it('should create a default config if one does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      ConfigManager.load();
      expect(fs.writeFileSync).toHaveBeenCalled();
      // Add more assertions to check the default config values
    });

    it('should load an existing config file', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ settings: { game: { resWidth: 1920 } } }));
      ConfigManager.load();
      expect(ConfigManager.getGameWidth()).toBe(1920);
    });

    it('should handle a corrupt config file', () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue('not json');
        ConfigManager.load();
        expect(fs.writeFileSync).toHaveBeenCalled();
        expect(ConfigManager.getGameWidth()).toBe(1280); // Default value
    });
  });

  describe('save()', () => {
    it('should save the current config to a file', () => {
        fs.existsSync.mockReturnValue(false);
        ConfigManager.load();
        ConfigManager.setGameWidth(1920);
        ConfigManager.save();
        const savedConfig = JSON.parse(fs.writeFileSync.mock.calls[1][1]);
        expect(savedConfig.settings.game.resWidth).toBe(1920);
    });
  });

});
