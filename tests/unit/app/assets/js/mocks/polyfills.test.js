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

        test.skip('pipeline should pipe streams and resolve on finish', async () => {
            const { Readable, Transform, pipeline } = require('../../../../../../app/assets/js/mocks/stream-polyfill')
            
            const source = new Readable({
                read() {
                    setTimeout(() => {
                        this.push('chunk')
                        this.push(null)
                    }, 10)
                }
            })
            
            const transform = new Transform({
                transform(chunk, enc, cb) {
                    cb(null, chunk.toString().toUpperCase())
                }
            })
            
            let result = ''
            const dest = new (require('../../../../../../app/assets/js/mocks/stream-polyfill').Writable)({
                write(chunk, enc, cb) {
                    result += chunk.toString()
                    cb()
                }
            })
            
            await pipeline(source, transform, dest)
            expect(result).toBe('CHUNK')
        }, 15000)

        test('Readable.fromWeb should convert web stream to node stream', (done) => {
            const { Readable } = require('../../../../../../app/assets/js/mocks/stream-polyfill')
            
            // Mock Web ReadableStream
            const webStream = {
                getReader: () => ({
                    read: jest.fn()
                        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('web') })
                        .mockResolvedValueOnce({ done: true })
                })
            }
            
            const stream = Readable.fromWeb(webStream)
            let result = ''
            stream.on('data', chunk => { result += chunk.toString() })
            stream.on('end', () => {
                try {
                    expect(result).toBe('web')
                    done()
                } catch (e) {
                    done(e)
                }
            })
        })

        test('push should emit data events and end on null', (done) => {
            const { Readable } = require('../../../../../../app/assets/js/mocks/stream-polyfill')
            const stream = new Readable()
            let data = ''
            stream.on('data', chunk => data += chunk)
            stream.on('end', () => {
                expect(data).toBe('test')
                done()
            })
            stream.push('te')
            stream.push('st')
            stream.push(null)
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
