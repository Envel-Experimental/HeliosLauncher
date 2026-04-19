describe('SysUtil', () => {
    let SysUtil
    let os
    let fs
    let execFile

    beforeEach(() => {
        jest.resetModules()
        
        jest.mock('os', () => ({
            platform: jest.fn(),
            totalmem: jest.fn().mockReturnValue(16 * 1024 * 1024 * 1024),
            freemem: jest.fn().mockReturnValue(4 * 1024 * 1024 * 1024),
            release: jest.fn().mockReturnValue('10.0.0'),
            arch: jest.fn().mockReturnValue('x64')
        }))

        jest.mock('fs', () => ({
            readFile: jest.fn(),
            statfs: jest.fn(),
            mkdirSync: jest.fn()
        }))

        jest.mock('child_process', () => ({
            execFile: jest.fn()
        }))

        SysUtil = require('../../../../../app/assets/js/core/sysutil')
        os = require('os')
        fs = require('fs')
        execFile = require('child_process').execFile
    })

    test('getAvailableRamGb should return correct value on linux', async () => {
        os.platform.mockReturnValue('linux')
        fs.readFile.mockImplementation((path, options, callback) => callback(null, 'MemAvailable: 4194304 kB'))

        const free = await SysUtil.getAvailableRamGb()
        expect(free).toBe(4) // 4GB
    })

    test('getAvailableRamGb should return correct value on darwin', async () => {
        os.platform.mockReturnValue('darwin')
        execFile.mockImplementation((file, callback) => callback(null, 'Pages free: 524288\nPages inactive: 524288'))

        const free = await SysUtil.getAvailableRamGb()
        expect(free).toBe(4) // (524288 + 524288) * 4096 / 1024^3 = 4GB
    })

    test('getAvailableRamGb should return correct value on win32', async () => {
        os.platform.mockReturnValue('win32')
        os.freemem.mockReturnValue(2 * 1024 * 1024 * 1024)

        const free = await SysUtil.getAvailableRamGb()
        expect(free).toBe(2) // 2GB
    })
})
