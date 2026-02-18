const CrashHandler = require('@app/assets/js/crash-handler');
const fs = require('fs/promises');

// Mock fs/promises
jest.mock('fs/promises', () => ({
    stat: jest.fn(),
    open: jest.fn(),
}));

describe('CrashHandler', () => {

    // Reset mocks before each test
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('analyzeLog (synchronous)', () => {
        it('should detect corrupted TOML config files', () => {
            const log = 'Some log\nFailed loading config file example.toml\nMore log';
            const result = CrashHandler.analyzeLog(log);
            expect(result).toEqual({
                type: 'corrupted-config',
                file: 'example.toml',
                description: 'Ошибка загрузки конфига: example.toml'
            });
        });

        it('should detect corrupted .cfg files', () => {
            const log = 'Some log\nConfiguration file example.cfg is corrupt\nMore log';
            const result = CrashHandler.analyzeLog(log);
            expect(result).toEqual({
                type: 'corrupted-config',
                file: 'example.cfg',
                description: 'Файл конфигурации example.cfg поврежден.'
            });
        });

        it('should detect corrupted .json files (JsonSyntaxException)', () => {
            const log = 'Some log\ncom.google.gson.JsonSyntaxException: ... path/to/example.json\nMore log';
            const result = CrashHandler.analyzeLog(log);
            expect(result).toEqual({
                type: 'corrupted-config',
                file: 'example.json',
                description: 'Файл конфигурации example.json поврежден (ошибка синтаксиса).'
            });
        });

        it('should detect missing version json file (ENOENT)', () => {
            const log = "ENOENT: no such file or directory, open 'C:\\Users\\Dns11\\AppData\\Roaming\\.foxford\\common\\versions\\1.20.1-fabric-0.16.10\\1.20.1-fabric-0.16.10.json'";
            const result = CrashHandler.analyzeLog(log);
            expect(result).toEqual({
                type: 'missing-version-file',
                file: '1.20.1-fabric-0.16.10.json',
                description: "Файл версии поврежден. Нажми 'Исправить' для восстановления."
            });
        });

        it('should return null for unknown errors', () => {
            const log = 'Some random error\nSomething went wrong';
            const result = CrashHandler.analyzeLog(log);
            expect(result).toBeNull();
        });
    });

    describe('analyzeFile (asynchronous with partial read)', () => {
        const filePath = '/mock/path/to/latest.log';
        let mockFileHandle;

        beforeEach(() => {
            mockFileHandle = {
                read: jest.fn(),
                close: jest.fn()
            };
            fs.open.mockResolvedValue(mockFileHandle);
        });

        it('should read the file tail and detect crash', async () => {
            const crashLog = 'Some log content\nFailed loading config file corrupted.toml\nEnd of log';
            const fileSize = 2000;
            const buffer = Buffer.from(crashLog);

            // Mock fs.stat
            fs.stat.mockResolvedValue({ size: fileSize });

            // Mock FileHandle.read
            mockFileHandle.read.mockImplementation(async (buf, offset, length, position) => {
                buffer.copy(buf);
                return { bytesRead: buffer.length, buffer: buf };
            });

            const result = await CrashHandler.analyzeFile(filePath);

            expect(fs.stat).toHaveBeenCalledWith(filePath);
            expect(fs.open).toHaveBeenCalledWith(filePath, 'r');
            expect(mockFileHandle.read).toHaveBeenCalled();
            expect(mockFileHandle.close).toHaveBeenCalled();

            expect(result).toEqual({
                type: 'corrupted-config',
                file: 'corrupted.toml',
                description: 'Ошибка загрузки конфига: corrupted.toml'
            });
        });

        it('should handle small files correctly (read entire file)', async () => {
            const content = "Short log";
            const fileSize = content.length;

            fs.stat.mockResolvedValue({ size: fileSize });

            mockFileHandle.read.mockImplementation(async (buf, offset, length, position) => {
                const len = Buffer.from(content).copy(buf);
                return { bytesRead: len, buffer: buf };
            });

            const result = await CrashHandler.analyzeFile(filePath);

            expect(mockFileHandle.read).toHaveBeenCalled();
            expect(result).toBeNull(); // "Short log" has no crash
        });

        it('should handle empty files', async () => {
            fs.stat.mockResolvedValue({ size: 0 });

            const result = await CrashHandler.analyzeFile(filePath);

            expect(fs.open).not.toHaveBeenCalled();
            expect(result).toBeNull();
        });

        it('should gracefully handle file read errors and log to console.error', async () => {
            // stat succeeds
            fs.stat.mockResolvedValue({ size: 100 });
            // open fails
            fs.open.mockRejectedValue(new Error('Permission denied'));

            // Mock console.error
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            const result = await CrashHandler.analyzeFile(filePath);

            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalled();
            expect(consoleSpy.mock.calls[0][0]).toContain('Failed to read log file tail');

            consoleSpy.mockRestore();
        });
    });

});
