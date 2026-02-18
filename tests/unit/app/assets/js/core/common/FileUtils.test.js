const { validateLocalFile } = require('@app/assets/js/core/common/FileUtils')
const fs = require('fs/promises')
const { createReadStream } = require('fs')
const crypto = require('crypto')
const { Readable } = require('stream')

jest.mock('fs/promises')
jest.mock('fs')

describe('FileUtils', () => {
    describe('validateLocalFile', () => {
        const filePath = 'testFile.jar'
        const content = 'test content'
        const sha256Hash = crypto.createHash('sha256').update(content).digest('hex')
        const sha1Hash = crypto.createHash('sha1').update(content).digest('hex')

        beforeEach(() => {
            jest.clearAllMocks()
        })

        it('should return true if no hash is provided', async () => {
            const result = await validateLocalFile(filePath, 'SHA-256', null)
            expect(result).toBe(true)
        })

        it('should return false if file does not exist', async () => {
            fs.stat.mockRejectedValue(new Error('File not found'))
            const result = await validateLocalFile(filePath, 'SHA-256', sha256Hash)
            expect(result).toBe(false)
            expect(fs.stat).toHaveBeenCalledWith(filePath)
        })

        it('should validate file with SHA-256 correctly', async () => {
            fs.stat.mockResolvedValue({ size: content.length })
            const mockStream = new Readable({
                read() {
                    this.push(content)
                    this.push(null)
                }
            })
            createReadStream.mockReturnValue(mockStream)

            const result = await validateLocalFile(filePath, 'SHA-256', sha256Hash, content.length)
            expect(result).toBe(true)
        })

        it('should validate file with SHA-1 correctly', async () => {
            fs.stat.mockResolvedValue({ size: content.length })
            const mockStream = new Readable({
                read() {
                    this.push(content)
                    this.push(null)
                }
            })
            createReadStream.mockReturnValue(mockStream)

            const result = await validateLocalFile(filePath, 'SHA-1', sha1Hash, content.length)
            expect(result).toBe(true)
        })

        it('should return false if hash does not match', async () => {
            fs.stat.mockResolvedValue({ size: content.length })
            const mockStream = new Readable({
                read() {
                    this.push('different content')
                    this.push(null)
                }
            })
            createReadStream.mockReturnValue(mockStream)

            const result = await validateLocalFile(filePath, 'SHA-256', sha256Hash, content.length)
            expect(result).toBe(false)
        })

        it('should return false if size does not match', async () => {
            fs.stat.mockResolvedValue({ size: content.length + 1 })
            const result = await validateLocalFile(filePath, 'SHA-256', sha256Hash, content.length)
            expect(result).toBe(false)
        })

        it('should handle stream errors gracefully', async () => {
            fs.stat.mockResolvedValue({ size: content.length })
            const mockStream = new Readable({
                read() {
                    this.emit('error', new Error('Read error'))
                }
            })
            createReadStream.mockReturnValue(mockStream)

            const result = await validateLocalFile(filePath, 'SHA-256', sha256Hash, content.length)
            expect(result).toBe(false)
        })
    })
})
