const { app } = require('electron')
const path = require('path')
const fs = require('fs')

// We need to point to the right files
const rootDir = path.join(__dirname, '..')
const ConfigManager = require(path.join(rootDir, 'app/assets/js/core/configmanager'))
const Analytics = require(path.join(rootDir, 'app/assets/js/core/util/Analytics'))

console.log('--- Aptabase Verification Script ---')

app.on('ready', async () => {
    console.log('[Test] Electron app ready.')
    
    try {
        // Ensure we have a version.json for the release property
        const versionPath = path.join(rootDir, 'app/assets/version.json')
        if (!fs.existsSync(versionPath)) {
            console.log('[Test] Creating temporary version.json...')
            fs.writeFileSync(versionPath, JSON.stringify({ version: '3.0.0-test', release: 'FLauncher@3.0.0-test' }))
        }

        console.log('[Test] Loading ConfigManager...')
        await ConfigManager.load()

        console.log('[Test] Initializing Analytics...')
        await Analytics.init()
        
        console.log('[Test] Sending verification event to Aptabase...')
        await Analytics.capture('Aptabase Verification', {
            test_id: 'test_' + Math.random().toString(36).substring(7),
            message: 'If you see this in your Aptabase dashboard, the integration is successful!',
            platform: process.platform,
            node_version: process.version,
            electron_version: process.versions.electron,
            app_version: Analytics.release, // Test if this matches FLauncher@version+hash
            timestamp: new Date().toISOString()
        })
        
        console.log('[SUCCESS] Verification event SENT.')
        console.log('Check your Aptabase dashboard at https://app.aptabase.com')
        
        // Wait a bit to ensure network request finishes
        setTimeout(() => {
            console.log('[Test] Shutting down...')
            app.quit()
        }, 3000)

    } catch (err) {
        console.error('[ERROR] Verification failed:', err)
        app.quit()
        process.exit(1)
    }
})
