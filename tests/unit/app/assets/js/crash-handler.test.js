const CrashHandler = require('@app/assets/js/crash-handler');

describe('CrashHandler', () => {

    it('should detect corrupted TOML config files', () => {
        const log = 'Some log\nException loading config file example.toml\nMore log';
        const result = CrashHandler.analyzeLog(log);
        expect(result).toEqual({
            type: 'corrupted-config',
            file: 'example.toml',
            description: 'The configuration file example.toml appears to be corrupted.'
        });
    });

    it('should detect corrupted .cfg files', () => {
        const log = 'Some log\nConfiguration file example.cfg is corrupt\nMore log';
        const result = CrashHandler.analyzeLog(log);
        expect(result).toEqual({
            type: 'corrupted-config',
            file: 'example.cfg',
            description: 'The configuration file example.cfg appears to be corrupted.'
        });
    });

    it('should detect corrupted .json files (JsonSyntaxException)', () => {
        const log = 'Some log\ncom.google.gson.JsonSyntaxException: ... path/to/example.json\nMore log';
        const result = CrashHandler.analyzeLog(log);
        expect(result).toEqual({
            type: 'corrupted-config',
            file: 'example.json',
            description: 'The configuration file example.json appears to be corrupted.'
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
