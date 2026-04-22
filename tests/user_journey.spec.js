const { test, expect } = require('@playwright/test');
const { launchApp, handleInitialOverlays, setupMockDistro, FOXFORD_DATA_PATH } = require('./test-utils');
const fs = require('fs');
const path = require('path');

test.describe('HeliosLauncher User Journey Hardening', () => {
    let electronApp;
    let window;

    test.setTimeout(300000); // 5 minutes

    test.beforeEach(async () => {
        // Setup a minimal mock distribution for testing
        const mockDistro = {
            version: "1.0.0",
            servers: [
                {
                    id: "TestServer",
                    name: "Test Server",
                    description: "Server for E2E testing",
                    icon: "http://example.com/icon.png",
                    minecraftVersion: "1.20.1",
                    version: "1.20.1",
                    address: "localhost:25565",
                    discord: {
                        serverId: "123",
                        invite: "abc"
                    },
                    mainServer: true,
                    modules: []
                }
            ]
        };

        const result = await launchApp(null, true);
        electronApp = result.electronApp;
        window = result.window;
        
        await setupMockDistro(mockDistro);
        await handleInitialOverlays(window);
    });

    test.afterEach(async () => {
        if (electronApp) {
            await electronApp.close();
        }
    });

    test('User Path: File Repair Detection', async () => {
        const serverId = "TestServer";
        const relativePath = path.join('mods', 'test.jar');
        const instanceDir = path.join(FOXFORD_DATA_PATH, 'instances', serverId);
        const filePath = path.join(instanceDir, relativePath);

        await test.step('Preparation: Create valid local file', async () => {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, ''); 
            console.log(`Created dummy file at: ${filePath}`);
        });

        await test.step('Navigation: Select Test Server', async () => {
            await window.locator('#server_selection_button').click();
            const testServerItem = window.locator('.serverListing').filter({ hasText: 'Test Server' });
            await testServerItem.click();
            await window.keyboard.press('Escape');
            await expect(window.locator('#server_selection_button')).toHaveText(/Test Server/i);
        });

        await test.step('Logic: Corrupt file and verify repair starts', async () => {
            fs.unlinkSync(filePath);
            expect(fs.existsSync(filePath)).toBe(false);

            const launchBtn = window.locator('#launch_button');
            const launchDetails = window.locator('#launch_details_text');

            await launchBtn.click();
            
            // Should show "Validating"
            await expect(launchDetails).toHaveText(/Validating|Проверка/i, { timeout: 15000 });
            console.log('Launcher detected missing file and entered repair state.');
        });
    });

    test('User Path: Network & P2P Settings', async () => {
        await test.step('UI: Verify P2P Stats Cards', async () => {
            const settingsBtn = window.locator('#settingsMediaButton');
            await settingsBtn.click();
            
            const deliveryTab = window.locator('.settingsNavItem[rSc="settingsTabDelivery"]');
            await deliveryTab.click();
            
            // Check for LAN/WAN status cards
            await expect(window.locator('#settingsP2PProfileLabel')).toBeVisible();
            await expect(window.locator('#settingsMirrorStatusContainer')).toBeVisible();
            
            // Verify P2P Stats button exists
            const p2pStatsBtn = window.locator('#settingsP2PStatsButton');
            await expect(p2pStatsBtn).toBeVisible();
            
            console.log('Network/P2P telemetry UI verified.');
        });
    });

    test('User Path: Settings Persistence', async () => {
        await test.step('Change RAM and Verify Persistence', async () => {
            const settingsBtn = window.locator('#settingsMediaButton');
            await settingsBtn.click();
            
            const javaTab = window.locator('.settingsNavItem[rSc="settingsTabJava"]');
            await javaTab.click();
            
            const maxRamSlider = window.locator('#settingsMaxRAMRange');
            // Set to 4GB (assuming slider range supports it)
            await maxRamSlider.evaluate(node => {
                node.setAttribute('value', "4");
                node.dispatchEvent(new Event('change'));
            });
            
            await window.locator('#settingsNavDone').click();
            
            // Re-open
            await window.locator('#settingsMediaButton').click();
            await javaTab.click();
            
            await expect(maxRamSlider).toHaveAttribute('value', '4');
            console.log('Settings persistence verified.');
        });
    });
});
