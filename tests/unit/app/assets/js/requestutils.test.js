const { downloadFile } = require('@app/assets/js/requestutils')
const fs = require('fs-extra')
const path = require('path')
const { Readable } = require('stream')

// Mock fs-extra
jest.mock('fs-extra', () => ({
    ensureDir: jest.fn().mockResolvedValue(),
    createWriteStream: jest.fn()
}))

// Mock fetch globally
global.fetch = jest.fn()

describe('requestutils', () => {
    const testUrl = 'https://example.com/file.zip'
    const testPath = '/tmp/file.zip'

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('downloadFile downloads file successfully', async () => {
        // Mock Response
        const mockBody = new Readable()
        mockBody.push('test content')
        mockBody.push(null)

        // We need to mock Readable.fromWeb because node-fetch or internal fetch might be used
        // But since we are mocking fetch, we control the response body.
        // In our implementation we check response.body.

        const mockResponse = {
            ok: true,
            status: 200,
            body: mockBody,
            headers: { get: () => '12' }
        }
        global.fetch.mockResolvedValue(mockResponse)

        // Mock write stream
        const mockWriteStream = new Readable() // Hack to make it a stream
        mockWriteStream._read = () => {}
        mockWriteStream.write = jest.fn()
        mockWriteStream.end = jest.fn()
        // Simple mock for pipeline destination
        mockWriteStream.on = jest.fn().mockImplementation((event, cb) => {
             if (event === 'close' || event === 'finish') {
                 // Defer callback to simulate async
                 process.nextTick(cb)
             }
             return mockWriteStream
        })
        mockWriteStream.once = jest.fn()
        mockWriteStream.emit = jest.fn()
        fs.createWriteStream.mockReturnValue(mockWriteStream)

        // Mock Readable.fromWeb if not present in test env (Jest JSDOM/Node)
        if (!Readable.fromWeb) {
            Readable.fromWeb = jest.fn(body => body)
        }

        await downloadFile({ url: testUrl, path: testPath })

        expect(global.fetch).toHaveBeenCalledWith(testUrl, {})
        expect(fs.ensureDir).toHaveBeenCalledWith(path.dirname(testPath))
        expect(fs.createWriteStream).toHaveBeenCalledWith(testPath)
    })

    test('downloadFile throws error on non-ok response', async () => {
        global.fetch.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found'
        })

        await expect(downloadFile({ url: testUrl, path: testPath }))
            .rejects.toThrow('Failed to download https://example.com/file.zip: 404 Not Found')
    })

    test('downloadFile passes headers', async () => {
        const mockBody = new Readable()
        mockBody.push(null)
        global.fetch.mockResolvedValue({
            ok: true,
            body: mockBody,
            headers: { get: () => '0' }
        })

        const mockWriteStream = new Readable()
        mockWriteStream._read = () => {}
        mockWriteStream.on = jest.fn().mockImplementation((e, cb) => { if (e==='finish' || e==='close') process.nextTick(cb); return mockWriteStream })
        mockWriteStream.once = () => {}
        mockWriteStream.emit = () => {}
        fs.createWriteStream.mockReturnValue(mockWriteStream)

        const headers = { 'Authorization': 'Bearer token' }
        await downloadFile({ url: testUrl, path: testPath, headers })

        expect(global.fetch).toHaveBeenCalledWith(testUrl, { headers })
    })
})
