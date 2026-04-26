const path = require('path')

describe('Renderer Polyfills Verification', () => {
    
    describe('Path Polyfill', () => {
        const pathPolyfill = require('../../../../../../app/assets/js/mocks/path-polyfill')
        
        test('relative should calculate correct relative path', () => {
            const from = 'C:/Users/Nikita/AppData/Roaming/.foxford'
            const to = 'C:/Users/Nikita/AppData/Roaming/.foxford/common/version_manifest_v2.json'
            expect(pathPolyfill.relative(from, to)).toBe('common/version_manifest_v2.json')
        })

        test('relative should handle parent directories', () => {
            const from = 'C:/Users/Nikita/AppData/Roaming/.foxford/common'
            const to = 'C:/Users/Nikita/AppData/Roaming/.foxford/assets'
            expect(pathPolyfill.relative(from, to)).toBe('../assets')
        })
    })

    describe('FS Polyfill', () => {
        let fsPolyfill
        
        beforeEach(() => {
            // Mock HeliosAPI
            global.window = {
                HeliosAPI: {
                    ipc: {
                        invoke: jest.fn().mockResolvedValue(true),
                        sendSync: jest.fn().mockReturnValue(true)
                    }
                }
            }
            jest.resetModules()
            fsPolyfill = require('../../../../../../app/assets/js/mocks/fs-polyfill')
        })

        afterEach(() => {
            delete global.window
        })

        test('createWriteStream should collect data and call writeFile on finish', (done) => {
            const testPath = 'test.txt'
            const stream = fsPolyfill.createWriteStream(testPath)
            
            stream.on('finish', () => {
                try {
                    // Check if ipc.invoke('fs:writeFile', ...) was called
                    expect(global.window.HeliosAPI.ipc.invoke).toHaveBeenCalledWith(
                        'fs:writeFile', 
                        testPath, 
                        expect.any(Buffer), 
                        undefined
                    )
                    const writtenBuffer = global.window.HeliosAPI.ipc.invoke.mock.calls[0][2]
                    expect(writtenBuffer.toString()).toBe('hello world')
                    done()
                } catch (e) {
                    done(e)
                }
            })

            stream.write(Buffer.from('hello '))
            stream.write(Buffer.from('world'))
            stream.end()
        })
    })

    describe('Crypto Polyfill', () => {
        let cryptoPolyfill
        
        beforeEach(() => {
            global.window = {
                HeliosAPI: {
                    ipc: {
                        sendSync: jest.fn().mockReturnValue(true)
                    }
                }
            }
            jest.resetModules()
            cryptoPolyfill = require('../../../../../../app/assets/js/mocks/crypto-polyfill')
        })

        afterEach(() => {
            delete global.window
        })

        test('verify should call IPC crypto:verifySync', () => {
            const data = 'data'
            const key = 'key'
            const sig = 'sig'
            const res = cryptoPolyfill.verify('sha256', data, key, sig)
            
            expect(global.window.HeliosAPI.ipc.sendSync).toHaveBeenCalledWith(
                'crypto:verifySync',
                'sha256',
                data,
                key,
                sig
            )
            expect(res).toBe(true)
        })
    })
})
