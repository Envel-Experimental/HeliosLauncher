const HashVerifierStream = require('@network/HashVerifierStream')
const TrafficState = require('@network/TrafficState')
const StatsManager = require('@network/StatsManager')
const ResourceMonitor = require('@network/ResourceMonitor')
const { PassThrough } = require('stream')
const fs = require('fs')

describe('Network Core Modules', () => {
    
    describe('HashVerifierStream', () => {
        test('should verify correct hash', (done) => {
            const data = Buffer.from('hello world')
            const hash = require('crypto').createHash('sha256').update(data).digest('hex')
            const verifier = new HashVerifierStream('sha256', hash)
            
            const source = new PassThrough()
            source.pipe(verifier)
            
            verifier.on('finish', () => {
                done()
            })
            
            source.end(data)
        })

        test('should emit error on hash mismatch', (done) => {
            const data = Buffer.from('hello world')
            const verifier = new HashVerifierStream('sha256', 'wrong-hash')
            
            const source = new PassThrough()
            source.pipe(verifier)
            
            verifier.on('error', (err) => {
                expect(err.code).toBe('HASH_MISMATCH')
                done()
            })
            
            source.end(data)
        })

        test('should handle invalid algorithm gracefully', (done) => {
            const spy = jest.spyOn(console, 'error').mockImplementation()
            const verifier = new HashVerifierStream('invalid-algo', 'hash')
            
            const data = Buffer.from('data')
            const source = new PassThrough()
            source.pipe(verifier)
            
            verifier.on('error', (err) => {
                expect(err.message).toContain('Invalid algorithm')
                spy.mockRestore()
                done()
            })
            
            source.end(data)
        })
    })

    describe('TrafficState', () => {
        test('should track active downloads', () => {
            TrafficState.incrementDownloads()
            TrafficState.incrementDownloads()
            expect(TrafficState.isBusy()).toBe(true)
            
            TrafficState.decrementDownloads()
            TrafficState.decrementDownloads()
            expect(TrafficState.isBusy()).toBe(false)
        })
    })

    describe('StatsManager', () => {
        test('should record and persist stats', () => {
            // Mock fs
            jest.spyOn(fs, 'writeFileSync').mockImplementation()
            jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ totalUploaded: 100, totalDownloaded: 100 }))
            jest.spyOn(fs, 'existsSync').mockReturnValue(true)

            StatsManager.init('/mock/dir')
            StatsManager.record(50, 50)
            
            const stats = StatsManager.getStats()
            expect(stats.up).toBe(150)
            expect(stats.down).toBe(150)
            
            expect(fs.writeFileSync).toHaveBeenCalled()
            jest.restoreAllMocks()
        })
    })

    describe('ResourceMonitor', () => {
        test('should provide CPU and Stress info', () => {
            expect(ResourceMonitor.getStressLevel()).toBeDefined()
            expect(typeof ResourceMonitor.getCPUUsage()).toBe('number')
        })
    })
})
