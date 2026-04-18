const { test, expect } = require('@playwright/test');
const { launchApp, handleInitialOverlays, openSettings, switchSettingsTab, FOXFORD_DATA_PATH } = require('./test-utils');
const fs = require('fs');
const path = require('path');
const os = require('os');

test.describe('Settings Boundaries and Resilience', () => {
    let app, window;

    test.afterEach(async () => {
        if (app) await app.close();
    });

    test('RAM slider should respect 70% and 12GB limits', async () => {
        const result = await launchApp();
        app = result.electronApp;
        window = result.window;

        await handleInitialOverlays(window);
        await openSettings(window);
        await switchSettingsTab(window, 'settingsTabJava');

        // Calculate expected limit
        const totalMemGb = Math.floor(os.totalmem() / 1024 / 1024 / 1024);
        const expectedLimitGb = Math.max(1, Math.min(Math.floor(totalMemGb * 0.7), 12));

        console.log(`[Test] Total System RAM: ${totalMemGb}GB`);
        console.log(`[Test] Expected Limit: ${expectedLimitGb}GB`);

        const maxRamSlider = window.locator('#settingsMaxRAMRange');
        const sliderMaxAttr = await maxRamSlider.getAttribute('max');
        
        expect(Number(sliderMaxAttr)).toBe(expectedLimitGb);
        // 3. Verify total RAM in status shows physical RAM, and slider max shows limit
        const memoryStatusTotal = window.locator('#settingsMemoryTotal');
        const statusText = await memoryStatusTotal.innerText();
        
        // Physical RAM check (should be around 32G or whatever is on the machine)
        expect(statusText).toMatch(/\d+(\.\d+)?G/);
        expect(parseFloat(statusText)).toBeGreaterThan(expectedLimitGb);

        const maxAttr = await window.getAttribute('#settingsMaxRAMRange', 'max');
        expect(Number(maxAttr)).toBe(expectedLimitGb);
        
        console.log(`[Test] UI Total RAM: ${statusText}, Slider Max: ${maxAttr}G`);
        console.log('PASS: RAM boundaries and physical reporting are correct.');
    });

    test('Resolution inputs should persist valid numbers', async () => {
        const result = await launchApp();
        app = result.electronApp;
        window = result.window;

        await handleInitialOverlays(window);
        await openSettings(window);
        
        // Resolution is in the Minecraft tab
        await switchSettingsTab(window, 'settingsTabMinecraft');
        
        const widthInput = window.locator('#settingsGameWidth');
        const heightInput = window.locator('#settingsGameHeight');

        await widthInput.fill('1920');
        await heightInput.fill('1080');

        const doneBtn = window.locator('#settingsNavDone');
        await doneBtn.click();
        await expect(window.locator('#settingsContainer')).toBeHidden();
        
        // Give it a moment to write the file
        await window.waitForTimeout(1000);

        // Verify in config
        const config = JSON.parse(fs.readFileSync(path.join(FOXFORD_DATA_PATH, 'config.json'), 'utf-8'));
        expect(config.settings.game.resWidth).toBe(1920);
        expect(config.settings.game.resHeight).toBe(1080);
        
        console.log('PASS: Resolution settings correctly saved.');
    });

    test('UI should be resilient to undefined view transitions', async () => {
        const result = await launchApp();
        app = result.electronApp;
        window = result.window;

        await handleInitialOverlays(window);

        // Attempt a transition to undefined via evaluate
        console.log('[Test] Triggering transition to undefined...');
        await window.evaluate(() => {
            // @ts-ignore
            window.switchView(window.VIEWS.landing, undefined, 500, 500);
        });

        // Wait a bit for the transition to finish
        await window.waitForTimeout(1500);

        // Check if landing container is still visible (it shouldn't be hidden forever)
        // Or at least check if we can still interact with the UI
        const landingVisible = await window.locator('#landingContainer').isVisible();
        console.log(`[Test] Landing visible after failed transition: ${landingVisible}`);
        
        // Even if it's hidden, we should be able to open settings (UI not frozen)
        const settingsBtn = window.locator('#settingsMediaButton');
        await settingsBtn.click();
        await expect(window.locator('#settingsContainer')).toBeVisible({ timeout: 5000 });
        
        console.log('PASS: UI remains responsive after undefined transition attempt.');
    });

    test('App should be resilient to corrupted config (Defaults Fallback)', async () => {
        // 1. Manually corrupt the config before launch
        if (!fs.existsSync(FOXFORD_DATA_PATH)) {
            fs.mkdirSync(FOXFORD_DATA_PATH, { recursive: true });
        }
        // Write invalid JSON or missing required fields
        fs.writeFileSync(path.join(FOXFORD_DATA_PATH, 'config.json'), '{"settings": { "broken": true }}');

        const result = await launchApp(); // This will trigger ConfigManager.load()
        app = result.electronApp;
        window = result.window;

        await handleInitialOverlays(window);
        
        // Verify that the app still loaded and used defaults
        const resWidth = await window.evaluate(() => window.ConfigManager.getGameWidth());
        expect(resWidth).toBeGreaterThan(0); // Should be the default value (e.g. 1280)
        
        console.log(`[Test] Resiliently fell back to width: ${resWidth}`);
        console.log('PASS: Application is resilient to corrupted configuration.');
    });

    test('System info and version should be correctly displayed', async () => {
        const result = await launchApp();
        app = result.electronApp;
        window = result.window;

        await handleInitialOverlays(window);
        await openSettings(window);
        
        // 1. Check About Tab for version
        await switchSettingsTab(window, 'settingsTabAbout');
        const versionValue = window.locator('#settingsAboutCurrentVersionValue');
        
        // Wait for it to be updated from "Loading..."
        await expect(versionValue).not.toHaveText('Loading...', { timeout: 10000 });
        const versionText = await versionValue.innerText();
        
        console.log(`[Test] Displayed Version: ${versionText}`);
        expect(versionText).not.toBe('0.0.1-alpha.18');
        expect(versionText).toMatch(/^\d+\.\d+\.\d+/); // Should look like 2.4.1 etc.

        // 2. Check Java Tab for RAM and Disk
        await switchSettingsTab(window, 'settingsTabJava');
        
        const totalRam = window.locator('#settingsMemoryTotal');
        const availRam = window.locator('#settingsMemoryAvail');
        const availDisk = window.locator('#settingsDiskAvail');
        
        await expect(totalRam).not.toHaveText('Loading...', { timeout: 10000 });
        await expect(availRam).not.toHaveText('Loading...');
        await expect(availDisk).not.toHaveText('Calculating...');
        await expect(availDisk).not.toHaveText('N/A');
        
        const totalRamVal = await totalRam.innerText();
        const availDiskVal = await availDisk.innerText();
        
        console.log(`[Test] UI RAM: ${totalRamVal}, UI Disk: ${availDiskVal}`);
        
        expect(totalRamVal).toMatch(/\d+(\.\d+)?G/);
        expect(availDiskVal).toMatch(/\d+(\.\d+)?G/);
        
        console.log('PASS: System information correctly populated.');
    });
});
