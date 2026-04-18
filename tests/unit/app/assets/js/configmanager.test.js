const path = require('path')

describe('ConfigManager', () => {
    let ConfigManager
    let fs
    let util

    beforeEach(() => {
        jest.resetModules()
        
        // Mock fs
        jest.mock('fs', () => ({
            existsSync: jest.fn(),
            mkdirSync: jest.fn(),
            promises: {
                mkdir: jest.fn().mockResolvedValue(),
                readFile: jest.fn(),
                writeFile: jest.fn()
            }
        }))

        // Mock core util
        // Correct path: tests/unit/app/assets/js/configmanager.test.js -> core/util
        jest.mock('../../../../../app/assets/js/core/util', () => ({
            move: jest.fn().mockResolvedValue(),
            retry: jest.fn((fn) => fn()),
            safeReadJson: jest.fn().mockResolvedValue({}),
            safeWriteJson: jest.fn().mockResolvedValue(),
            LoggerUtil: {
                getLogger: jest.fn(() => ({
                    info: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn()
                }))
            }
        }))

        // Mock SecurityUtils - found in core/util/SecurityUtils
        jest.mock('../../../../../app/assets/js/core/util/SecurityUtils', () => ({
            decryptString: jest.fn(s => s),
            encryptString: jest.fn(s => s)
        }))

        // Mock electron
        jest.mock('electron', () => ({
            app: {
                getPath: jest.fn().mockReturnValue('/mock/userData')
            }
        }))

        ConfigManager = require('../../../../../app/assets/js/core/configmanager')
        fs = require('fs')
        util = require('../../../../../app/assets/js/core/util')
    })

    describe('load()', () => {
        it('should load config from the default path', async () => {
            fs.existsSync.mockReturnValue(true)
            util.safeReadJson.mockResolvedValue({
                settings: { launcher: { dataDirectory: '/mock/data' } }
            })

            await ConfigManager.load()
            expect(ConfigManager.getDataDirectory()).toBe('/mock/data')
        })
    })

    describe('save()', () => {
        it('should save the current config to a file', async () => {
            fs.existsSync.mockReturnValue(true)
            util.safeReadJson.mockResolvedValue({
                settings: { launcher: { dataDirectory: '/mock/data' } }
            })

            await ConfigManager.load()
            await ConfigManager.save()
            expect(util.safeWriteJson).toHaveBeenCalled()
        })
    })
})
