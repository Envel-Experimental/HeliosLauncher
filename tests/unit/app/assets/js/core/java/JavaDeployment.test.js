jest.mock('@app/assets/js/core/configmanager');
jest.mock('@app/assets/js/core/java/JavaGuard');
jest.mock('@app/assets/js/core/pathutil');
jest.mock('@app/assets/js/core/dl/DownloadEngine');
jest.mock('@app/assets/js/core/dl/FullRepair', () => ({ FullRepair: jest.fn() }));
jest.mock('@network/P2PEngine', () => ({
    start: jest.fn(),
    stop: jest.fn()
}));
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

const LaunchController = require('@app/assets/js/core/LaunchController');
const ConfigManager = require('@app/assets/js/core/configmanager');
const JavaGuard = require('@app/assets/js/core/java/JavaGuard');
const pathutil = require('@app/assets/js/core/pathutil');

describe('Java Deployment Logic', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
    });

    it('should request MSI installer if the data path is dirty (non-ASCII)', async () => {
        const dirtyPath = 'C:\\Users\\Никита\\AppData\\Roaming\\.foxford';
        ConfigManager.getDataDirectory.mockReturnValue(dirtyPath);
        pathutil.isPathValid.mockReturnValue(false);

        JavaGuard.latestOpenJDK.mockResolvedValue({
            url: 'https://test.mirror/java-installer.msi',
            size: 100,
            path: 'local/path/to/installer.msi',
            isInstaller: true
        });

        await LaunchController.downloadJava({ major: 17 });

        expect(JavaGuard.latestOpenJDK).toHaveBeenCalledWith(
            17,
            dirtyPath,
            'installer'
        );
        expect(JavaGuard.runInstaller).toHaveBeenCalledWith('local/path/to/installer.msi');
    });

    it('should request standard ZIP if the data path is stable', async () => {
        const cleanPath = 'C:\\Games\\Launcher';
        ConfigManager.getDataDirectory.mockReturnValue(cleanPath);
        pathutil.isPathValid.mockReturnValue(true);

        JavaGuard.latestOpenJDK.mockResolvedValue({
            url: 'https://test.mirror/java-portable.zip',
            size: 100,
            path: 'local/path/to/portable.zip',
            isInstaller: false
        });
        JavaGuard.extractJdk.mockResolvedValue('extracted/path/java.exe');

        const result = await LaunchController.downloadJava({ major: 17 });

        expect(JavaGuard.latestOpenJDK).toHaveBeenCalledWith(
            17,
            cleanPath,
            null
        );
        expect(JavaGuard.extractJdk).toHaveBeenCalledWith('local/path/to/portable.zip');
        expect(result).toBe('extracted/path/java.exe');
    });
});
