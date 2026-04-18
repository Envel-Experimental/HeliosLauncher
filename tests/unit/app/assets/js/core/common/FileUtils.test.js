const { Readable, PassThrough } = require('stream')

describe('FileUtils', () => {
    let FileUtils
    let fs
    let crypto
    let fsSync

    beforeEach(() => {
        jest.resetModules()
        
        const mockFs = {
            stat: jest.fn(),
            mkdir: jest.fn().mockResolvedValue(),
            readFile: jest.fn(),
            writeFile: jest.fn(),
        }
        jest.mock('fs/promises', () => mockFs)
        
        jest.mock('fs', () => ({
            createReadStream: jest.fn(),
            existsSync: jest.fn(),
            readFileSync: jest.fn(),
            writeFileSync: jest.fn(),
        }))

        jest.mock('crypto', () => ({
            createHash: jest.fn()
        }))

        // Correct path: tests/unit/app/assets/js/core/common/FileUtils.test.js -> core/common/FileUtils
        FileUtils = require('../../../../../../../app/assets/js/core/common/FileUtils')
        fs = require('fs/promises')
        fsSync = require('fs')
        crypto = require('crypto')
    })

    test('validateLocalFile resolves true if hash matches', async () => {
        fs.stat.mockResolvedValue({ size: 100 })
        
        const mockReadStream = new Readable({
            read() {
                this.push('data')
                this.push(null)
            }
        })
        fsSync.createReadStream.mockReturnValue(mockReadStream)

        const mockHashStream = new PassThrough()
        mockHashStream.read = jest.fn().mockReturnValue(Buffer.from('hashedvalue'))
        crypto.createHash.mockReturnValue(mockHashStream)

        const result = await FileUtils.validateLocalFile('path', 'sha1', '68617368656476616c7565') // 'hashedvalue' in hex
        expect(result).toBe(true)
    })

    test('calculateHashByBuffer returns correct hash', () => {
        const mockHash = {
            update: jest.fn().mockReturnThis(),
            digest: jest.fn().mockReturnValue('hashedvalue')
        }
        crypto.createHash.mockReturnValue(mockHash)

        const result = FileUtils.calculateHashByBuffer(Buffer.from('test'), 'sha1')
        expect(result).toBe('hashedvalue')
    })
})
