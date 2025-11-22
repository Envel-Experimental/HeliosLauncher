const path = require('path')

jest.mock('fs-extra')
const fs = require('fs-extra')

jest.mock('@app/assets/js/configmanager')
const ConfigManager = require('@app/assets/js/configmanager')

jest.mock('@envel/helios-core', () => {
    const mockLogger = {
        info: jest.fn(),
        warn: jest.fn()
    }
    return {
        LoggerUtil: {
            getLogger: () => mockLogger
        }
    }
}, { virtual: true })

const { LoggerUtil } = require('@envel/helios-core')
const mockLogger = LoggerUtil.getLogger()

const ValidationCacheManager = require('@app/assets/js/validationcachemanager')

describe('ValidationCacheManager', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        // We also need to clear the specific mock functions on our shared logger mock
        mockLogger.info.mockClear()
        mockLogger.warn.mockClear()

        ConfigManager.getLauncherDirectory.mockReturnValue('/mock/launcher/dir')
    })

    test('load() should load cache if it exists', async () => {
        const mockCache = { 'file1': { size: 100, mtime: 12345 } }
        fs.pathExists.mockResolvedValue(true)
        fs.readJson.mockResolvedValue(mockCache)

        await ValidationCacheManager.load()

        expect(ConfigManager.getLauncherDirectory).toHaveBeenCalled()
        expect(fs.pathExists).toHaveBeenCalledWith(path.join('/mock/launcher/dir', 'validation-cache.json'))
        expect(fs.readJson).toHaveBeenCalledWith(path.join('/mock/launcher/dir', 'validation-cache.json'))
        expect(ValidationCacheManager.getCache()).toEqual(mockCache)
        expect(mockLogger.info).toHaveBeenCalledWith('Validation cache loaded.')
    })

    test('load() should handle missing cache file', async () => {
        fs.pathExists.mockResolvedValue(false)

        await ValidationCacheManager.load()

        expect(ValidationCacheManager.getCache()).toEqual({})
        expect(mockLogger.info).toHaveBeenCalledWith('No validation cache found.')
    })

    test('updateCache() should merge data and save to file', async () => {
        const initialCache = { 'file1': { size: 100 } }
        const newData = { 'file2': { size: 200 } }

        fs.pathExists.mockResolvedValue(true)
        fs.readJson.mockResolvedValue(initialCache)
        await ValidationCacheManager.load()

        await ValidationCacheManager.updateCache(newData)

        const expectedCache = { ...initialCache, ...newData }
        expect(ValidationCacheManager.getCache()).toEqual(expectedCache)
        expect(fs.writeJson).toHaveBeenCalledWith(
            path.join('/mock/launcher/dir', 'validation-cache.json'),
            expectedCache
        )
        expect(mockLogger.info).toHaveBeenCalledWith('Validation cache updated.')
    })
})
