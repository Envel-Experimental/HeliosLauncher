describe('sysutil', () => {
    let sysutil
    let os
    let fs
    let child_process

    beforeEach(() => {
        jest.resetModules()

        jest.doMock('os', () => ({
            platform: jest.fn(),
            totalmem: jest.fn(),
            freemem: jest.fn()
        }))
        jest.doMock('fs', () => ({
            readFile: jest.fn(),
            statfs: jest.fn()
        }))
        jest.doMock('child_process', () => ({
            execFile: jest.fn()
        }))
        jest.doMock('../../../../../../app/assets/js/core/configmanager', () => ({
            getDataDirectory: jest.fn().mockReturnValue('/mock/data')
        }))

        sysutil = require('../../../../../../app/assets/js/core/sysutil')
        os = require('os')
        fs = require('fs')
        child_process = require('child_process')
    })

    describe('getAvailableRamGb', () => {
        it('should resolve RAM for macOS (darwin)', async () => {
            os.platform.mockReturnValue('darwin')
            child_process.execFile.mockImplementation((cmd, callback) => {
                callback(null, 'Pages free: 100000\nPages inactive: 50000')
            })

            const ram = await sysutil.getAvailableRamGb()
            expect(ram).toBeCloseTo(0.572, 3)
        })

        it('should resolve RAM for Linux with MemAvailable', async () => {
            os.platform.mockReturnValue('linux')
            fs.readFile.mockImplementation((path, encoding, callback) => {
                callback(null, 'MemAvailable: 2097152 kB')
            })

            const ram = await sysutil.getAvailableRamGb()
            expect(ram).toBe(2)
        })

        it('should resolve RAM for Windows using freemem', async () => {
            os.platform.mockReturnValue('win32')
            os.freemem.mockReturnValue(3 * 1024 * 1024 * 1024)

            const ram = await sysutil.getAvailableRamGb()
            expect(ram).toBe(3)
        })
    })

    describe('getFreeDiskSpaceGb', () => {
        it('should resolve disk space using statfs', async () => {
            fs.statfs.mockImplementation((path, callback) => {
                callback(null, { bavail: 1000000, bsize: 4096 })
            })

            const disk = await sysutil.getFreeDiskSpaceGb()
            expect(disk).toBeCloseTo(3.8147, 4)
        })
    })

    describe('performChecks', () => {
        it('should return warnings for low resources', async () => {
            os.totalmem.mockReturnValue(4 * 1024 * 1024 * 1024)
            os.platform.mockReturnValue('win32')
            os.freemem.mockReturnValue(500 * 1024 * 1024)
            fs.statfs.mockImplementation((path, callback) => {
                callback(null, { bavail: 1, bsize: 1024 })
            })

            const warnings = await sysutil.performChecks()
            expect(warnings).toContain('lowTotalRAM')
            expect(warnings).toContain('lowFreeRAM')
            expect(warnings).toContain('lowDiskSpace')
        })
    })
})
