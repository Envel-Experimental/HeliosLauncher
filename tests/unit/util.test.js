const path = require('path')

// Mock fs and fs.promises
const mockFsPromises = {
    mkdir: jest.fn().mockResolvedValue(),
    readFile: jest.fn().mockResolvedValue(''),
    writeFile: jest.fn().mockResolvedValue(),
    rename: jest.fn().mockResolvedValue(),
    rm: jest.fn().mockResolvedValue(),
    cp: jest.fn().mockResolvedValue(),
    stat: jest.fn().mockResolvedValue({}),
    access: jest.fn().mockResolvedValue(),
}

jest.mock('fs', () => ({
    promises: mockFsPromises,
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    renameSync: jest.fn(),
    readFileSync: jest.fn().mockReturnValue(''),
}))

describe('Util', () => {
    let Util
    let fsPromises

    beforeEach(() => {
        jest.resetModules()
        
        // Correct path: tests/unit/util.test.js -> core/util
        Util = require('../../app/assets/js/core/util')
        fsPromises = require('fs').promises
        jest.clearAllMocks()
    })

    describe('retry', () => {
        it('should return result if function succeeds', async () => {
            const func = jest.fn().mockResolvedValue('success')
            const result = await Util.retry(func)
            expect(result).toBe('success')
        })
    })

    describe('ensureDir', () => {
        it('should call fs.promises.mkdir with recursive true', async () => {
            await Util.ensureDir('test-dir')
            expect(fsPromises.mkdir).toHaveBeenCalledWith('test-dir', { recursive: true })
        })
    })
})
