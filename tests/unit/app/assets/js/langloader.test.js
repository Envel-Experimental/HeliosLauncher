describe('LangLoader', () => {
    let LangLoader
    let fs
    let smolToml

    beforeEach(() => {
        jest.resetModules()
        
        // Mock fs
        jest.mock('fs', () => ({
            readFileSync: jest.fn().mockReturnValue('dummy content'),
            existsSync: jest.fn().mockReturnValue(true)
        }))

        // Mock smol-toml
        jest.mock('smol-toml', () => ({
            parse: jest.fn()
        }))

        // Mock electron
        jest.mock('electron', () => ({
            app: {
                getAppPath: jest.fn().mockReturnValue('')
            }
        }))

        // Mock core/util (including deepMerge used in loadLanguage)
        jest.mock('../../../../../app/assets/js/core/util', () => ({
            deepMerge: jest.fn((obj, defaults) => ({ ...defaults, ...obj })),
            LoggerUtil: {
                getLogger: jest.fn(() => ({
                    info: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn()
                }))
            }
        }))

        LangLoader = require('../../../../../app/assets/js/core/langloader')
        fs = require('fs')
        smolToml = require('smol-toml')
    })

    it('should query the correct JS string with placeholders', () => {
        smolToml.parse.mockReturnValue({
            js: {
                test: {
                    string: 'Hello {name}'
                }
            }
        })

        // Force reload internal state
        LangLoader.setupLanguage()
        const result = LangLoader.queryJS('test.string', { name: 'World' })
        expect(result).toBe('Hello World')
    })
})
