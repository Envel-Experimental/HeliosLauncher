const Util = require('../../app/assets/js/util')
const fs = require('fs/promises')
const path = require('path')

jest.mock('fs/promises')

describe('Util', () => {
    afterEach(() => {
        jest.clearAllMocks()
    })

    describe('retry', () => {
        it('should return result if function succeeds', async () => {
            const func = jest.fn().mockResolvedValue('success')
            const result = await Util.retry(func)
            expect(result).toBe('success')
            expect(func).toHaveBeenCalledTimes(1)
        })

        it('should retry if function fails', async () => {
            const func = jest.fn()
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValue('success')

            const result = await Util.retry(func, 3, 1)
            expect(result).toBe('success')
            expect(func).toHaveBeenCalledTimes(2)
        })

        it('should throw if retries exhausted', async () => {
            const func = jest.fn().mockRejectedValue(new Error('fail'))
            await expect(Util.retry(func, 3, 1)).rejects.toThrow('fail')
            expect(func).toHaveBeenCalledTimes(3)
        })
    })

    describe('ensureDir', () => {
        it('should call fs.mkdir with recursive true', async () => {
            await Util.ensureDir('/path/to/dir')
            expect(fs.mkdir).toHaveBeenCalledWith('/path/to/dir', { recursive: true })
        })
    })

    describe('safeReadJson', () => {
        it('should return parsed object if file exists', async () => {
            fs.readFile.mockResolvedValue('{"foo":"bar"}')
            const result = await Util.safeReadJson('/path/to/file.json')
            expect(result).toEqual({ foo: 'bar' })
            expect(fs.readFile).toHaveBeenCalledWith('/path/to/file.json', 'utf-8')
        })

        it('should return null if file does not exist', async () => {
            const error = new Error('ENOENT')
            error.code = 'ENOENT'
            fs.readFile.mockRejectedValue(error)

            const result = await Util.safeReadJson('/path/to/file.json')
            expect(result).toBeNull()
        })

        it('should throw if file is corrupted', async () => {
            fs.readFile.mockResolvedValue('{invalid json')
            await expect(Util.safeReadJson('/path/to/file.json')).rejects.toThrow()
        })
    })

    describe('safeWriteJson', () => {
        it('should write to temp file and rename', async () => {
            // Mock Date.now to have predictable temp file name
            jest.spyOn(Date, 'now').mockReturnValue(1234567890)

            const file = '/path/to/file.json'
            const data = { foo: 'bar' }
            const tempFile = file + '.tmp.' + 1234567890

            await Util.safeWriteJson(file, data)

            expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(file), { recursive: true })
            expect(fs.writeFile).toHaveBeenCalledWith(tempFile, JSON.stringify(data, null, 4), 'utf-8')
            expect(fs.rename).toHaveBeenCalledWith(tempFile, file)
        })

        it('should clean up temp file if write fails', async () => {
            jest.spyOn(Date, 'now').mockReturnValue(1234567890)
            const file = '/path/to/file.json'
            const tempFile = file + '.tmp.' + 1234567890

            fs.writeFile.mockRejectedValue(new Error('write failed'))

            await expect(Util.safeWriteJson(file, {})).rejects.toThrow('write failed')
            expect(fs.rm).toHaveBeenCalledWith(tempFile, { force: true })
        })
    })

    describe('move', () => {
        it('should use fs.rename', async () => {
            await Util.move('/src', '/dest')
            expect(fs.mkdir).toHaveBeenCalledWith(path.dirname('/dest'), { recursive: true })
            expect(fs.rename).toHaveBeenCalledWith('/src', '/dest')
        })

        it('should fallback to copy/delete on EXDEV', async () => {
            const error = new Error('EXDEV')
            error.code = 'EXDEV'
            fs.rename.mockRejectedValue(error)

            await Util.move('/src', '/dest')
            expect(fs.mkdir).toHaveBeenCalledWith(path.dirname('/dest'), { recursive: true })
            expect(fs.cp).toHaveBeenCalledWith('/src', '/dest', { recursive: true, force: true })
            expect(fs.rm).toHaveBeenCalledWith('/src', { recursive: true, force: true })
        })
    })
})
