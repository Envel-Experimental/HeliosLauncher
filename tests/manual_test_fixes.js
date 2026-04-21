const path = require('path')
const fs = require('fs')

// 1. MOCK ENVIRONMENT
global.ConfigManager = {
    getP2POnlyMode: () => false,
    getDataDirectory: () => './temp',
    getCommonDirectory: () => './temp/common',
    getLauncherDirectory: () => './temp',
    getLauncherDirectorySync: () => './temp',
    getSettings: () => ({}),
    isLoaded: () => true,
    load: async () => {}
}

global.Lang = {
    queryJS: (id) => id
}

// 2. MOCK ELECTRON
const Module = require('module')
const originalRequire = Module.prototype.require
Module.prototype.require = function() {
    const name = arguments[0]
    if (name === 'electron') {
        return {
            app: {
                getAppPath: () => path.join(__dirname, '..'),
                getPath: (n) => path.join(__dirname, '../temp', n)
            },
            shell: { openExternal: () => {} },
            ipcRenderer: { invoke: () => Promise.resolve() },
            remote: { app: { getVersion: () => '1.0.0' } }
        }
    }
    // Handle aliases manually for this script
    if (name.startsWith('@core/')) return originalRequire.apply(this, [path.join(__dirname, '../app/assets/js/core/', name.substring(6) + '.js')])
    if (name.startsWith('@network/')) return originalRequire.apply(this, [path.join(__dirname, '../network/', name.substring(9) + '.js')])
    if (name === '@app/assets/js/core/configmanager') return global.ConfigManager
    
    return originalRequire.apply(this, arguments)
}

// 3. MOCK FETCH
global.fetch = async (url) => {
    if (url.includes('api.adoptium.net')) {
        return {
            ok: true,
            json: async () => [
                {
                    version: { major: 21 },
                    binary: {
                        os: 'windows', image_type: 'jdk', architecture: 'x64',
                        package: { link: 'http://mock.url/jdk21.zip', size: 12345, name: 'jdk21.zip', checksum: 'mock' }
                    }
                }
            ]
        }
    }
    return { ok: false, status: 404 }
}

// 4. RUN TESTS
async function run() {
    console.log('\x1b[36m%s\x1b[0m', '=== HeliosLauncher Fix Verification ===\n')

    // Test Case 1: Java Discovery
    try {
        const { latestOpenJDK } = require('../app/assets/js/core/java/JavaGuard')
        console.log('[Case 1] Testing Java 21 Discovery (String Version + MSI Fallback)...')
        const java = await latestOpenJDK("21", "./temp", "installer")
        if (java && java.id === 'jdk21.zip') {
            console.log('\x1b[32m%s\x1b[0m', '  SUCCESS: Java found and correctly fell back to ZIP from MSI.')
        } else {
            console.log('\x1b[31m%s\x1b[0m', '  FAILED: Java discovery returned incorrect result.')
        }
    } catch (e) {
        console.error('  ERROR:', e.message)
    }

    // Test Case 2: Download Error Capping
    try {
        console.log('\n[Case 2] Testing Download Error Message Capping...')
        const { downloadQueue } = require('../app/assets/js/core/dl/DownloadEngine')
        const assets = Array.from({ length: 12 }, (_, i) => ({ id: `sound_${i}.ogg`, url: 'http://fail', path: `sound_${i}.ogg`, size: 100 }))
        
        // Mock fetch failure
        global.fetch = () => Promise.reject(new Error('Network Fail'))
        
        try {
            await downloadQueue(assets)
        } catch (err) {
            console.log('  Message:', err.message)
            if (err.message.includes('... и еще 7 файл(ов)')) {
                console.log('\x1b[32m%s\x1b[0m', '  SUCCESS: Error message correctly capped at 5 files.')
            } else {
                console.log('\x1b[31m%s\x1b[0m', '  FAILED: Error message was not capped correctly.')
            }
        }
    } catch (e) {
        console.error('  ERROR:', e.message)
    }

    console.log('\n\x1b[36m%s\x1b[0m', '=== Verification Complete ===')
}

run()
