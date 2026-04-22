describe('DistributionAPI Detailed Tests', () => {
    let DistributionAPI
    let fs
    let configmanager
    let SignatureUtils
    let HeliosDistribution

    beforeEach(() => {
        jest.resetModules()

        // Mock Dependencies using Aliases
        jest.doMock('fs/promises', () => ({
            readFile: jest.fn(),
            writeFile: jest.fn(),
            access: jest.fn(),
            mkdir: jest.fn()
        }))

        jest.doMock('@core/configmanager', () => ({
            fetchWithTimeout: jest.fn()
        }))

        jest.doMock('@core/util/SignatureUtils', () => ({
            verifyDistribution: jest.fn()
        }))

        jest.doMock('@common/DistributionClasses', () => ({
            HeliosDistribution: jest.fn().mockImplementation((data) => ({
                raw: data
            }))
        }))

        jest.doMock('@core/util/LoggerUtil', () => ({
            LoggerUtil: {
                getLogger: jest.fn(() => ({
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn()
                }))
            }
        }))

        const distroModule = require('@common/DistributionAPI')
        DistributionAPI = distroModule.DistributionAPI
        fs = require('fs/promises')
        configmanager = require('@core/configmanager')
        SignatureUtils = require('@core/util/SignatureUtils')
        HeliosDistribution = require('@common/DistributionClasses').HeliosDistribution
    })

    test('getDistributionLocalLoadOnly should throw if file is missing', async () => {
        fs.access.mockRejectedValue(new Error('ENOENT'))
        const api = new DistributionAPI('/mock/launcher', '/mock/common', '/mock/instance', 'http://url', false)
        
        await expect(api.getDistributionLocalLoadOnly()).rejects.toThrow('FATAL: Unable to load distribution from local disk.')
    })

    test('pullRemote should verify signature and return data', async () => {
        const mockData = { timestamp: new Date().toISOString(), servers: [] }
        configmanager.fetchWithTimeout.mockImplementation((url) => {
            if (url.endsWith('.sig')) {
                return Promise.resolve({ ok: true, text: () => Promise.resolve('mock-sig') })
            }
            return Promise.resolve({
                ok: true,
                arrayBuffer: () => Promise.resolve(Buffer.from(JSON.stringify(mockData)))
            })
        })

        SignatureUtils.verifyDistribution.mockReturnValue(true)

        const api = new DistributionAPI('/mock/launcher', '/mock/common', '/mock/instance', 'http://url', false, ['key1'])
        const res = await api.pullRemote()

        expect(res.data).toEqual(mockData)
        expect(res.signatureValid).toBe(true)
    })

    test('pullRemote should detect anti-replay attack', async () => {
        const oldTimestamp = new Date(Date.now() - 10000).toISOString()
        const mockData = { timestamp: oldTimestamp }
        
        configmanager.fetchWithTimeout.mockImplementation((url) => {
            if (url.endsWith('.sig')) {
                return Promise.resolve({ ok: true, text: () => Promise.resolve('mock-sig') })
            }
            return Promise.resolve({
                ok: true,
                arrayBuffer: () => Promise.resolve(Buffer.from(JSON.stringify(mockData)))
            })
        })

        SignatureUtils.verifyDistribution.mockReturnValue(true)

        const api = new DistributionAPI('/mock/launcher', '/mock/common', '/mock/instance', 'http://url', false, ['key1'])
        
        const localTimestamp = Date.now()
        const res = await api.pullRemote(localTimestamp)
        
        expect(res.responseStatus).toBe('ERROR')
        expect(res.error.message).toContain('Distribution replay attack detected')
    })
})
