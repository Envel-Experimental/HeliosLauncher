describe('SysUtil', () => {
    let SysUtil
    let os
    let exec

    beforeEach(() => {
        jest.resetModules()
        
        jest.mock('os', () => ({
            platform: jest.fn(),
            totalmem: jest.fn(),
            freemem: jest.fn(),
            release: jest.fn().mockReturnValue('10.0.0'),
            arch: jest.fn().mockReturnValue('x64')
        }))

        jest.mock('child_process', () => ({
            exec: jest.fn()
        }))

        SysUtil = require('../../../../../app/assets/js/core/sysutil')
        os = require('os')
        exec = require('child_process').exec
    })

    test('getAvailableRamGb should return correct value on linux', async () => {
        os.platform.mockReturnValue('linux')
        exec.mockImplementation((command, callback) => callback(null, 'MemAvailable: 4194304 kB'))

        const free = await SysUtil.getAvailableRamGb()
        expect(free).toBe(4) // 4GB
    })

    test('getAvailableRamGb should return correct value on win32', async () => {
        os.platform.mockReturnValue('win32')
        os.freemem.mockReturnValue(2 * 1024 * 1024 * 1024)

        const free = await SysUtil.getAvailableRamGb()
        expect(free).toBe(2) // 2GB
    })
})
