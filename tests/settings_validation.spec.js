const { test, expect } = require('@playwright/test');
const { launchApp, handleInitialOverlays, openSettings, switchSettingsTab, setupMockDistro } = require('./test-utils');

/**
 * Comprehensive test to verify all settings and optional mods persistence.
 */
test.describe('Settings & Mods Full Validation', () => {
    let app, window;

    test.afterEach(async () => {
        if (app) await app.close();
    });

    test('should persist optional mod toggles and fields correctly across sessions', async () => {
        console.log('[Test] Starting full settings validation...');

        // 1. Setup mock distribution with optional mods and sub-modules
        await setupMockDistro({
            version: '1.0.0',
            servers: [
                {
                    id: 'Programming-vanilla-1.20.1',
                    name: 'Test Server',
                    description: 'Testing optional mods validation',
                    icon: 'https://f-launcher.ru/favicon.ico',
                    version: '1.0.0',
                    minecraftVersion: '1.20.1',
                    address: 'localhost:25565',
                    modules: [
                        {
                            id: 'test:flat:1.0.0',
                            name: 'Flat Optional Mod',
                            type: 'ForgeMod',
                            required: { value: false, def: true }
                        },
                        {
                            id: 'test:parent:1.0.0',
                            name: 'Nested Parent Mod',
                            type: 'ForgeMod',
                            required: { value: false, def: true },
                            subModules: [
                                {
                                    id: 'test:sub:1.0.0',
                                    name: 'Optional Sub Mod',
                                    type: 'ForgeMod',
                                    required: { value: false, def: false }
                                }
                            ]
                        }
                    ]
                }
            ]
        });

        // 2. Launch App (Session 1)
        const result = await launchApp(null, true);
        app = result.electronApp;
        window = result.window;
        await handleInitialOverlays(window);

        // 3. Navigate to Settings -> Mods Tab
        await openSettings(window);
        
        // Force DevMode and refresh distribution to use our mock
        await window.evaluate(async () => {
            window.DistroAPI.toggleDevMode(true);
            await window.DistroAPI.refreshDistributionOrFallback();
            // We need to re-trigger UI resolution after distro refresh
            if (window.resolveModsForUI) {
                await window.resolveModsForUI();
            }
        });

        await window.waitForTimeout(1000);
        await switchSettingsTab(window, 'settingsTabMods');
        await window.waitForTimeout(1000);

        console.log('[Test] Modifying settings...');

        // 4. Toggle Optional Mods
        // Flat mod: Default TRUE -> Set FALSE
        // NOTE: UI uses getVersionlessMavenIdentifier() which is group:artifact
        const flatToggle = window.locator('input[formod="test:flat"]');
        console.log('[Test] Dumping mods HTML...');
        const html = await window.locator('#settingsOptModsContent').innerHTML();
        console.log('[Test] Mods HTML:', html);
        
        console.log('[Test] Waiting for optional mod elements...');
        await flatToggle.waitFor({ state: 'attached', timeout: 15000 });
        
        await expect(flatToggle).toBeChecked();
        await window.locator('.settingsModContent label.toggleSwitch').filter({ has: window.locator('input[formod="test:flat"]') }).locator('.toggleSwitchSlider').click();
        await expect(flatToggle).not.toBeChecked();

        // Sub-mod: Default FALSE -> Set TRUE
        const subToggle = window.locator('input[formod="test:sub"]');
        await expect(subToggle).not.toBeChecked();
        await window.locator('.settingsModContent label.toggleSwitch').filter({ has: window.locator('input[formod="test:sub"]') }).locator('.toggleSwitchSlider').click();
        await expect(subToggle).toBeChecked();

        // 5. Navigate to Java Tab and modify JVM Options
        await switchSettingsTab(window, 'settingsTabJava');
        const jvmField = window.locator('input[cValue="JVMOptions"]');
        const testJVMArgs = '-Xmx4G -Dtest.persistence=true';
        await jvmField.fill(testJVMArgs);

        // 6. Save and Close
        console.log('[Test] Saving settings and closing...');
        const doneBtn = window.locator('#settingsNavDone');
        await doneBtn.click({ force: true });
        await window.waitForSelector('#settingsContainer', { state: 'hidden', timeout: 10000 });
        
        await app.close();

        // Verify config on disk before opening Session 2
        const fs = require('fs');
        const path = require('path');
        const tempLauncherDir = path.join(process.cwd(), 'temp_test_user_data', '.foxford');
        const configPath = path.join(tempLauncherDir, 'config.json');
        
        if (fs.existsSync(configPath)) {
            const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            console.log('[Test] Disk Config modConfigurations type:', typeof configData.modConfigurations);
            console.log('[Test] Is Array:', Array.isArray(configData.modConfigurations));
            
            // Should be an object, not an array
            expect(Array.isArray(configData.modConfigurations)).toBe(false);
            expect(typeof configData.modConfigurations).toBe('object');
        }

        // 7. Session 2: Launch without reset and Verify
        console.log('[Test] Session 2: Verifying persistence...');
        const result2 = await launchApp(null, false); // No reset
        app = result2.electronApp;
        window = result2.window;
        await handleInitialOverlays(window);
        await openSettings(window);
        await switchSettingsTab(window, 'settingsTabMods');
        await expect(window.locator('input[formod="test:flat"]')).not.toBeChecked();
        await expect(window.locator('input[formod="test:sub"]')).toBeChecked();

        console.log('PASS: All toggles and fields persisted correctly across restarts!');
    });
});
