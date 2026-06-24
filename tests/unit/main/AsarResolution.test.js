const Module = require('module')
const { app } = require('electron')

describe('ASAR Resolution and Path Redirection', () => {
    let originalResolveFilename
    let patchedResolveFilename
    let originalRequestSingleInstanceLock
    let originalOn

    beforeAll(() => {
        // Setup mock methods so that requiring index.js doesn't crash or run side effects
        originalRequestSingleInstanceLock = app.requestSingleInstanceLock
        originalOn = app.on

        app.requestSingleInstanceLock = jest.fn().mockReturnValue(true)
        app.on = jest.fn()
        app.isPackaged = true

        originalResolveFilename = Module._resolveFilename

        // Overwrite Module._resolveFilename with a mock before requiring index.js
        // so index.js captures this mock as originalResolveFilename
        Module._resolveFilename = jest.fn().mockImplementation((request) => {
            if (request === 'mock-udx') {
                return 'C:\\Users\\MockUser\\AppData\\Local\\Programs\\flauncher\\resources\\app.asar\\node_modules\\udx-native\\package.json'
            }
            if (request === 'mock-sodium') {
                return '/usr/lib/flauncher/resources/app.asar/node_modules/sodium-native/package.json'
            }
            if (request === 'mock-react') {
                return 'C:\\Users\\MockUser\\AppData\\Local\\Programs\\flauncher\\resources\\app.asar\\node_modules\\react\\package.json'
            }
            return request
        })

        // Require index.js to apply the patch. Use isolateModules to ensure index.js is executed
        jest.isolateModules(() => {
            require('../../../index')
        })

        // Save the patched function
        patchedResolveFilename = Module._resolveFilename
    })

    afterAll(() => {
        // Restore original functions
        Module._resolveFilename = originalResolveFilename
        app.requestSingleInstanceLock = originalRequestSingleInstanceLock
        app.on = originalOn
        app.isPackaged = false
    })

    test('should redirect udx-native path inside app.asar to app.asar.unpacked', () => {
        const resolved = patchedResolveFilename('mock-udx', {}, false, {})
        expect(resolved).toBe('C:\\Users\\MockUser\\AppData\\Local\\Programs\\flauncher\\resources\\app.asar.unpacked\\node_modules\\udx-native\\package.json')
    })

    test('should redirect sodium-native path inside app.asar to app.asar.unpacked', () => {
        const resolved = patchedResolveFilename('mock-sodium', {}, false, {})
        expect(resolved).toBe('/usr/lib/flauncher/resources/app.asar.unpacked/node_modules/sodium-native/package.json')
    })

    test('should NOT redirect paths for modules that are not unpacked', () => {
        const resolved = patchedResolveFilename('mock-react', {}, false, {})
        expect(resolved).toBe('C:\\Users\\MockUser\\AppData\\Local\\Programs\\flauncher\\resources\\app.asar\\node_modules\\react\\package.json')
    })

    test('should NOT redirect paths when app is not packaged', () => {
        app.isPackaged = false
        const resolved = patchedResolveFilename('mock-udx', {}, false, {})
        expect(resolved).toBe('C:\\Users\\MockUser\\AppData\\Local\\Programs\\flauncher\\resources\\app.asar\\node_modules\\udx-native\\package.json')
        app.isPackaged = true
    })
})
