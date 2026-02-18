const FileUtils = require('@app/assets/js/core/common/FileUtils');
const fs = require('fs/promises');
const crypto = require('crypto');
const { createReadStream } = require('fs');
const { spawn } = require('child_process');

jest.mock('fs/promises');
jest.mock('fs', () => ({
    createReadStream: jest.fn()
}));
jest.mock('child_process');
jest.mock('crypto');

describe('FileUtils', () => {

    describe('validateLocalFile', () => {
        it('should return true if hash is null', async () => {
            const result = await FileUtils.validateLocalFile('path', 'sha1', null);
            expect(result).toBe(true);
        });

        it('should return false if file does not exist', async () => {
            fs.stat.mockRejectedValue(new Error('ENOENT'));
            const result = await FileUtils.validateLocalFile('path', 'sha1', 'hash');
            expect(result).toBe(false);
        });

        it('should return false if size mismatch', async () => {
            fs.stat.mockResolvedValue({ size: 100 });
            const result = await FileUtils.validateLocalFile('path', 'sha1', 'hash', 200);
            expect(result).toBe(false);
        });

        it('should validate hash correctly', async () => {
            fs.stat.mockResolvedValue({ size: 100 });



            const mockHash = {
                read: jest.fn().mockReturnValue(Buffer.from('aabbcc', 'hex')),
                on: jest.fn().mockImplementation((event, callback) => {
                    if (event === 'finish') {
                        // Use setTimeout to simulate async behavior and allow the promise to be pending first
                        setTimeout(callback, 0);
                    }
                    return mockHash;
                })
            };
            crypto.createHash.mockReturnValue(mockHash);

            const mockStream = {
                pipe: jest.fn().mockReturnValue(mockHash),
                on: jest.fn(),
                read: jest.fn()
            };
            createReadStream.mockReturnValue(mockStream);

            const result = await FileUtils.validateLocalFile('path', 'sha1', 'aabbcc');
            expect(result).toBe(true);
        });
    });

    describe('calculateHashByBuffer', () => {
        it('should calculate hash', () => {
            const mockHash = {
                update: jest.fn().mockReturnThis(),
                digest: jest.fn().mockReturnValue('hashedvalue')
            };
            crypto.createHash.mockReturnValue(mockHash);

            const result = FileUtils.calculateHashByBuffer(Buffer.from('test'), 'sha1');
            expect(result).toBe('hashedvalue');
        });
    });

    describe('safeEnsureDir', () => {
        it('should create directory recursively', async () => {
            await FileUtils.safeEnsureDir('/path/to/dir');
            expect(fs.mkdir).toHaveBeenCalledWith('/path/to/dir', { recursive: true });
        });
    });

});
