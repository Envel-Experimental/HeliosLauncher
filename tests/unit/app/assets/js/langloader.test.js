jest.mock('fs', () => ({
    readFileSync: jest.fn().mockReturnValue('[js.test]\nstring = "Hello {name}"'),
    existsSync: jest.fn().mockReturnValue(true),
    promises: {
        mkdir: jest.fn(),
        rename: jest.fn(),
        cp: jest.fn(),
        rm: jest.fn(),
        writeFile: jest.fn(),
        readFile: jest.fn()
    }
}))

jest.mock('electron', () => ({
    app: {
        getAppPath: jest.fn().mockReturnValue('')
    }
}))

describe('LangLoader', () => {
    let LangLoader
    let fs

    beforeEach(() => {
        jest.resetModules()
        
        LangLoader = require('../../../../../app/assets/js/core/langloader')
        fs = require('fs')
    })

    it('should query the correct JS string with placeholders', () => {
        // Force reload internal state
        LangLoader.setupLanguage()
        const result = LangLoader.queryJS('test.string', { name: 'World' })
        expect(result).toBe('Hello World')
    })
})
