const SysUtil = require('@app/assets/js/sysutil');
const os = require('os');
const { exec } = require('child_process');
const checkDiskSpace = require('check-disk-space').default;
const ConfigManager = require('@app/assets/js/configmanager');
const fs = require('fs-extra');
const path = require('path');

jest.mock('os', () => ({
    platform: jest.fn(),
    totalmem: jest.fn(),
    freemem: jest.fn(),
}));

jest.mock('child_process', () => ({
    exec: jest.fn(),
}));

jest.mock('check-disk-space', () => ({
    __esModule: true,
    default: jest.fn(),
}));

jest.mock('@app/assets/js/configmanager', () => ({
    getTotalRAMWarningShown: jest.fn(),
    setTotalRAMWarningShown: jest.fn(),
    save: jest.fn(),
}));

jest.mock('fs-extra', () => ({
    ensureDirSync: jest.fn(),
}));

describe('SysUtil', () => {
    it('should be an object', () => {
        expect(typeof SysUtil).toBe('object');
    });

    it('should perform system checks', async () => {
        os.platform.mockReturnValue('linux');
        os.totalmem.mockReturnValue(8 * 1024 * 1024 * 1024);
        exec.mockImplementation((command, callback) => callback(null, 'MemAvailable: 8192000 kB'));
        checkDiskSpace.mockResolvedValue({ free: 20 * 1024 * 1024 * 1024 });
        ConfigManager.getTotalRAMWarningShown.mockReturnValue(false);

        const warnings = await SysUtil.performChecks();
        expect(warnings).toEqual([]);
    });
});

describe('getLauncherRuntimeDir', () => {
    let originalPlatform;
    let originalArch;
    let originalPublicEnv;

    beforeEach(() => {
        // Reset mocks before each test
        fs.ensureDirSync.mockClear();
        jest.spyOn(console, 'error').mockImplementation(() => {}); // Suppress console.error

        // Store original process values
        originalPlatform = process.platform;
        originalArch = process.arch;
        originalPublicEnv = process.env.PUBLIC;

        // Mock process properties
        Object.defineProperty(process, 'platform', {
            configurable: true,
            value: 'linux',
        });
        Object.defineProperty(process, 'arch', {
            configurable: true,
            value: 'x64',
        });
        process.env.PUBLIC = 'C:\\Users\\Public';
    });

    afterEach(() => {
        // Restore original process values
        Object.defineProperty(process, 'platform', {
            configurable: true,
            value: originalPlatform,
        });
        Object.defineProperty(process, 'arch', {
            configurable: true,
            value: originalArch,
        });
        process.env.PUBLIC = originalPublicEnv;
        console.error.mockRestore();
    });

    it('should return default path on non-windows platform', () => {
        const dataDir = '/home/user/.foxford';
        const expectedPath = path.join(dataDir, 'runtime', 'x64');
        const result = SysUtil.getLauncherRuntimeDir(dataDir);
        expect(result).toBe(expectedPath);
    });

    it('should return default path on windows with clean path', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const dataDir = 'C:\\Users\\User\\.foxford';
        const expectedPath = path.join(dataDir, 'runtime', 'x64');
        const result = SysUtil.getLauncherRuntimeDir(dataDir);
        expect(result).toBe(expectedPath);
    });

    it('should return public path on windows with non-ascii path', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const dataDir = 'C:\\Users\\Тестовый юзер\\.foxford';
        const expectedPath = path.join('C:\\Users\\Public', '.foxford', 'runtime', 'x64');
        fs.ensureDirSync.mockReturnValue(true); // Simulate success
        const result = SysUtil.getLauncherRuntimeDir(dataDir);
        expect(result).toBe(expectedPath);
        expect(fs.ensureDirSync).toHaveBeenCalledWith(expectedPath);
    });

    it('should return default (problematic) path on windows if public path creation fails', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const dataDir = 'C:\\Users\\Тестовый юзер\\.foxford';
        const defaultPath = path.join(dataDir, 'runtime', 'x64');
        const publicPath = path.join('C:\\Users\\Public', '.foxford', 'runtime', 'x64');
        const error = new Error('Failed to create directory');
        fs.ensureDirSync.mockImplementation(() => {
            throw error;
        });
        const result = SysUtil.getLauncherRuntimeDir(dataDir);
        expect(result).toBe(defaultPath);
        expect(fs.ensureDirSync).toHaveBeenCalledWith(publicPath);
        expect(console.error).toHaveBeenCalledWith('Failed to create public runtime directory:', error);
    });
});
