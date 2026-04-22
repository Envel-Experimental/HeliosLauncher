describe('MirrorManager', () => {
    let MirrorManager
    let https

    beforeEach(() => {
        jest.resetModules()

        // Mock Dependencies
        jest.doMock('https', () => ({
            request: jest.fn()
        }))

        // Mock Logger/Console to avoid noise
        jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
        jest.spyOn(console, 'log').mockImplementation(() => true)

        MirrorManager = require('@network/MirrorManager')
        https = require('https')
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    describe('Initialization', () => {
        test('should initialize with provided mirrors and measure latencies', async () => {
            const mockConfigs = [
                { name: 'Mirror 1', distribution: 'https://m1.com/dist' },
                { name: 'Mirror 2', distribution: 'https://m2.com/dist' }
            ]

            // Mock https responses
            https.request.mockImplementation((options, callback) => {
                const res = {
                    statusCode: 200,
                    on: jest.fn((event, cb) => {
                        if (event === 'end') cb()
                    })
                }
                callback(res)
                return {
                    on: jest.fn(),
                    end: jest.fn(),
                    destroy: jest.fn()
                }
            })

            await MirrorManager.init(mockConfigs)

            expect(MirrorManager.initialized).toBe(true)
            expect(MirrorManager.mirrors.length).toBe(2)
            expect(https.request).toHaveBeenCalledTimes(2)
        })

        test('should handle missing configs gracefully', async () => {
            await MirrorManager.init(null)
            expect(MirrorManager.initialized).toBe(true)
            expect(MirrorManager.mirrors).toEqual([])
        })
    })

    describe('Mirror Selection and Ranking', () => {
        test('should sort mirrors by latency and status', async () => {
            MirrorManager.mirrors = [
                { config: { name: 'Slow' }, latency: 1000, status: 'slow' },
                { config: { name: 'Fast' }, latency: 50, status: 'active' },
                { config: { name: 'Down' }, latency: 9999, status: 'down' }
            ]

            MirrorManager._sortMirrors()

            const sorted = MirrorManager.getSortedMirrors()
            expect(sorted[0].name).toBe('Fast')
            expect(sorted[1].name).toBe('Slow')
            expect(sorted[2].name).toBe('Down')
        })
    })

    describe('Reporting', () => {
        test('reportSuccess should mark mirror as active', () => {
            MirrorManager.mirrors = [
                { config: { distribution: 'https://test.com' }, status: 'slow', successes: 0 }
            ]

            MirrorManager.reportSuccess('https://test.com/file', 100, 1024)

            expect(MirrorManager.mirrors[0].status).toBe('active')
            expect(MirrorManager.mirrors[0].successes).toBe(1)
        })

        test('reportFailure should mark mirror as down after threshold', () => {
            MirrorManager.mirrors = [
                { config: { distribution: 'https://test.com' }, status: 'active', failures: 14 }
            ]

            MirrorManager.reportFailure('https://test.com/file', 500)

            expect(MirrorManager.mirrors[0].status).toBe('down')
            expect(MirrorManager.mirrors[0].latency).toBe(9999)
        })
    })
})
