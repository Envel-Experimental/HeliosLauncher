describe('Java MSI Installation', () => {
    let runInstaller;
    let cp;

    const mockInstallerPath = 'C:\\path\\to\\java_installer.msi';

    beforeEach(() => {
        jest.resetModules();

        jest.mock('child_process', () => ({
            execFile: jest.fn(),
            exec: jest.fn() // Required because JavaGuard.js promisifies it at top level
        }));

        // Require the module AFTER mocking
        runInstaller = require('../../../../../../../app/assets/js/core/java/JavaGuard').runInstaller;
        cp = require('child_process');
    });

    test('should run MSI installer with /passive flag on Windows', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32' });

        cp.execFile.mockImplementation((cmd, args, callback) => {
            callback(null, 'success', '');
        });

        await runInstaller(mockInstallerPath);

        expect(cp.execFile).toHaveBeenCalledWith(
            'msiexec',
            ['/i', mockInstallerPath, '/passive'],
            expect.any(Function)
        );

        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    test('should reject if MSI installer fails', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32' });

        const mockError = new Error('Installation failed');
        cp.execFile.mockImplementation((cmd, args, callback) => {
            callback(mockError, '', 'error output');
        });

        await expect(runInstaller(mockInstallerPath)).rejects.toThrow('Installation failed');

        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
});
