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

        await test.step('Account: Open Login View', async () => {
            await window.locator('#settingsAddMojangAccount').click();
            await expect(window.locator('#loginContainer')).toBeVisible();
            await window.locator('#loginCancelButton').click();
            await expect(window.locator('#settingsContainer')).toBeVisible();
        });

        await test.step('Landing: Verify Instance List', async () => {
            await window.locator('#settingsNavDone').click();
            await expect(window.locator('#landingContainer')).toBeVisible();

            const serverBtn = window.locator('#server_selection_button');
            await serverBtn.click();
            
            const serverList = window.locator('#serverSelectListScrollable');
            // Give it a moment to populate
            await window.waitForTimeout(1000);
            await expect(serverList).toBeVisible();
            console.log('Instance list opened.');
        });

        await test.step('Final Checks: Launch button', async () => {
            await window.keyboard.press('Escape');
            await expect(window.locator('#landingContainer')).toBeVisible();

            const launchBtn = window.locator('#launch_button');
            await expect(launchBtn).toBeVisible();
            console.log('All E2E scenarios completed.');
        });
    });
});
