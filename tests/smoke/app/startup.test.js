const { _electron: electron } = require('playwright')
const { test, expect } = require('@playwright/test')

test.describe('Smoke', () => {
    test('should launch the application and open a window', async () => {
        const electronApp = await electron.launch({ args: ['.'] })
        const window = await electronApp.firstWindow()
        await window.waitForSelector('#main')
        const title = await window.title()
        expect(title).toMatch(/FLauncher|ФЛАУНЧЕР/)
        await electronApp.close()
    })
})
