const LangLoader = require('@app/assets/js/langloader');
const fs = require('fs');
const toml = require('smol-toml');

jest.mock('fs', () => ({
    readFileSync: jest.fn(),
}));

jest.mock('smol-toml', () => ({
    parse: jest.fn(),
}));

describe('LangLoader', () => {
    beforeEach(() => {
        fs.readFileSync.mockReturnValue('');
        toml.parse.mockReturnValue({
            js: {
                test: {
                    test: 'test',
                },
            },
            ejs: {
                test: {
                    test: 'test',
                },
            },
        });
        LangLoader.loadLanguage('en_US');
    });

    it('should query the correct JS string', () => {
        expect(LangLoader.queryJS('test.test')).toBe('test');
    });

    it('should query the correct EJS string', () => {
        expect(LangLoader.queryEJS('test.test')).toBe('test');
    });
});
