const { test, expect } = require('@playwright/test');
const { launchApp, handleInitialOverlays, openSettings, switchSettingsTab } = require('./test-utils');

test.describe('Settings Persistence', () => {
    let app, window;

    test.afterEach(async () => {
        if (app) await app.close();
    });

    test('should change and persist "Allow Prerelease" setting', async () => {
        // 1. Initial Launch
        const result = await launchApp();
        app = result.electronApp;
        window = result.window;

        await handleInitialOverlays(window);

        // 2. Open Settings and Switch to Launcher Tab
        await openSettings(window);
        await switchSettingsTab(window, 'settingsTabLauncher');

        // 3. Toggle Prerelease
        const prereleaseToggle = window.locator('input[cValue="AllowPrerelease"]');
        const initialState = await prereleaseToggle.isChecked();
        console.log(`[Test] Initial Prerelease state: ${initialState}`);
        
        await prereleaseToggle.click();
        const newState = await prereleaseToggle.isChecked();
        expect(newState).toBe(!initialState);

        // 4. Close Settings (Triggers Save)
        const doneBtn = window.locator('#settingsNavDone');
        await doneBtn.click();
        await expect(window.locator('#settingsContainer')).toBeHidden();

        // 5. Restart App and Verify
        await app.close();
        
        const result2 = await launchApp();
        app = result2.electronApp;
        window = result2.window;
        
        await handleInitialOverlays(window);

        // Check value via ConfigManager in Renderer
        const persistedState = await window.evaluate(() => window.ConfigManager.getAllowPrerelease());
        console.log(`[Test] Persisted Prerelease state: ${persistedState}`);
        
        expect(persistedState).toBe(newState);
        console.log('PASS: Settings persisted correctly across sessions.');
    });
});
