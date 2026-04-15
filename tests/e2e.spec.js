const { test, expect } = require('@playwright/test');
const { launchApp, handleInitialOverlays, openSettings, switchSettingsTab, TEST_USER_DATA } = require('./test-utils');
const fs = require('fs');
const path = require('path');

test.describe('HeliosLauncher E2E Flow', () => {
    let electronApp;
    let window;

    test.setTimeout(240000); // 4 minutes

    test.beforeAll(async () => {
        const result = await launchApp();
        electronApp = result.electronApp;
        window = result.window;
        await handleInitialOverlays(window);
    });

    test.afterAll(async () => {
        if (electronApp) {
            await electronApp.close();
        }
        // Final cleanup of temp data
        const TEST_DIR = path.join(process.cwd(), 'temp_test_user_data');
        if (fs.existsSync(TEST_DIR)) {
            try {
                fs.rmSync(TEST_DIR, { recursive: true, force: true });
            } catch (e) {
                console.log('Final cleanup failed:', e.message);
            }
        }
    });

    test('Full E2E Scenarios', async () => {
        await test.step('Navigation: Reach Landing and Open Settings', async () => {
            // Wait for UI initialization (requested 2-10s delay)
            await window.waitForTimeout(5000);
            await openSettings(window);
            await expect(window.locator('#settingsContainer')).toBeVisible();
        });

        await test.step('Settings: Change RAM & Persistence', async () => {
            await switchSettingsTab(window, 'settingsTabJava');
            const maxRamSlider = window.locator('#settingsMaxRAMRange');
            const minRamSlider = window.locator('#settingsMinRAMRange');
            
            // Set RAM values
            await maxRamSlider.evaluate(node => {
                node.setAttribute('value', "6");
                node.dispatchEvent(new Event('change'));
            });
            await minRamSlider.evaluate(node => {
                node.setAttribute('value', "2");
                node.dispatchEvent(new Event('change'));
            });
            await window.waitForTimeout(500);

            // Save and return to landing
            await window.locator('#settingsNavDone').click();
            await expect(window.locator('#landingContainer')).toBeVisible();

            // VERIFY ON DISK
            const configPath = path.join(TEST_USER_DATA, '.foxford', 'config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                console.log('Java Config on disk:', JSON.stringify(config.javaConfig));
                // We just verify it exists and is readable
                expect(config.javaConfig).toBeDefined();
            }

            // Re-open to verify UI persistence
            await openSettings(window);
            await switchSettingsTab(window, 'settingsTabJava');
            await expect(maxRamSlider).toHaveAttribute('value', '6');
            await expect(minRamSlider).toHaveAttribute('value', '2');
            console.log('RAM persistence verified in UI.');
        });

        await test.step('Account: Management (Switch & Delete)', async () => {
            await switchSettingsTab(window, 'settingsTabAccount');
            
            // Wait for account items to load
            const accountLocators = window.locator('.settingsCurrentAccounts .settingsAuthAccount');
            await accountLocators.first().waitFor({ state: 'attached', timeout: 10000 });

            const count = await accountLocators.count();
            console.log(`Found ${count} accounts in UI.`);

            if (count > 1) {
                // Switch to the second account (index based)
                const secondaryAcc = accountLocators.nth(1);
                const selectBtn = secondaryAcc.locator('.settingsAuthAccountSelect');
                // Use force: true because the parent container might intercept events during transition
                await selectBtn.click({ force: true });
                // Support both English and Russian localizations
                await expect(selectBtn).toHaveText(/Selected|Аккаунт выбран/i);

                // Delete the second account
                const logoutBtn = secondaryAcc.locator('.settingsAuthAccountLogOut');
                await logoutBtn.click({ force: true });
                
                // Wait for it to disappear (Helios uses fadeOut)
                await expect(secondaryAcc).toBeHidden({ timeout: 10000 });
                console.log('Account switching and deletion verified via index.');
            }
        });

        await test.step('Account: Login via UI', async () => {
            await switchSettingsTab(window, 'settingsTabAccount');
            await window.locator('#settingsAddMojangAccount').click();
            await expect(window.locator('#loginContainer')).toBeVisible();

            const usernameInput = window.locator('#loginUsername');
            await usernameInput.fill('TestUserTwo');
            
            const loginBtn = window.locator('#loginButton');
            await expect(loginBtn).toBeEnabled();
            await loginBtn.click();

            // Success might return to settings or landing depending on where it was opened
            // Wait for login container to disappear
            await expect(window.locator('#loginContainer')).toBeHidden({ timeout: 15000 });
            console.log('UI-based login successful (container hidden).');
        });

        await test.step('Landing: Verify Instance List Content', async () => {
            // Ensure we are on landing for this test
            if (!await window.locator('#landingContainer').isVisible()) {
                await window.locator('#settingsNavDone').click();
            }
            await expect(window.locator('#landingContainer')).toBeVisible();

            const serverBtn = window.locator('#server_selection_button');
            await serverBtn.click();
            
            const serverList = window.locator('#serverSelectListScrollable');
            await expect(serverList).toBeVisible();
            
            // Wait for server listings to appear
            const serverItems = window.locator('.serverListing');
            await serverItems.first().waitFor({ state: 'attached', timeout: 5000 });
            
            const serverCount = await serverItems.count();
            console.log(`Verified ${serverCount} servers in the list.`);
            expect(serverCount).toBeGreaterThan(0);
            
            await window.keyboard.press('Escape');
        });

        await test.step('Game: Attempt Launch Lifecycle', async () => {
            await expect(window.locator('#landingContainer')).toBeVisible();
            
            const launchBtn = window.locator('#launch_button');
            const launchDetails = window.locator('#launch_details');
            
            console.log('Starting launch process...');

            // Prepare a promise that resolves when the specific log is detected
            const logFoundPromise = new Promise((resolve) => {
                window.on('console', msg => {
                    const text = msg.text();
                    if (text.includes('[Minecraft]') && text.includes('Setting user:')) {
                        console.log('Detected Minecraft login log: ' + text);
                        resolve();
                    }
                });
            });

            await launchBtn.click();

            // First check for UI feedback
            await expect(launchDetails).toHaveText(/Запуск игры|Загрузка файлов|Проверка|Подготовка/i, { timeout: 30000 });
            console.log('UI confirmed launch start. Waiting for process logs...');

            // Wait for the specific log line from the process (timeout 2min)
            // Note: In test environment this requires dummy assets to be found or skipped
            await Promise.race([
                logFoundPromise,
                window.waitForTimeout(120000).then(() => { throw new Error('Timeout waiting for Minecraft log line'); })
            ]);
            
            console.log('Target log detected successfully. Terminating game process...');
            await window.evaluate(() => {
                if (window.activeMinecraftProcess) {
                    window.activeMinecraftProcess.kill();
                }
            });
            console.log('Game process killed. Launch verified.');
        });
    });
});
