// Mock Dependencies
const fs = require('fs')
jest.mock('fs', () => ({
    promises: {
        stat: jest.fn().mockResolvedValue({ size: 100 }),
        readFile: jest.fn(),
        mkdir: jest.fn()
    },
    createReadStream: jest.fn(() => ({
        on: jest.fn().mockReturnThis(),
        pipe: jest.fn().mockReturnThis(),
        error: jest.fn()
    })),
    existsSync: jest.fn()
}))

jest.mock('fs/promises', () => ({
    stat: jest.fn().mockResolvedValue({ size: 100 }),
    readFile: jest.fn(),
    mkdir: jest.fn()
}))

// Use a more robust mock for crypto
const { PassThrough } = require('stream')
const mHash = new PassThrough()
mHash.update = jest.fn().mockReturnThis()
mHash.digest = jest.fn().mockReturnValue(Buffer.from('deadbeef', 'hex'))
mHash.read = jest.fn().mockReturnValue(Buffer.from('deadbeef', 'hex'))

jest.mock('crypto', () => ({
    createHash: jest.fn(() => mHash)
}))

jest.mock('../../../../../../../app/assets/js/core/configmanager')

describe('Download Integrity & FileUtils Validation', () => {

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('should validate file hash correctly using FileUtils', async () => {
        const mockHashStream = {
            read: jest.fn().mockReturnValue(Buffer.from('deadbeef', 'hex')),
            on: jest.fn(function(event, cb) {
                if (event === 'finish') setImmediate(cb);
                return this;
            })
        };
        const mockReadStream = {
            on: jest.fn().mockReturnThis(),
            pipe: jest.fn().mockReturnValue(mockHashStream)
        };
        
        let FileUtils;
        jest.isolateModules(() => {
            const crypto = require('crypto');
            crypto.createHash = jest.fn(() => mockHashStream);
            const fs = require('fs');
            fs.createReadStream = jest.fn(() => mockReadStream);
            FileUtils = require('../../../../../../../app/assets/js/core/common/FileUtils');
        });

        // Call the function to trigger the mock
        const isValid = await FileUtils.validateLocalFile('test.jar', 'sha1', 'deadbeef', 100);
        
        expect(isValid).toBe(true);
    })
})
