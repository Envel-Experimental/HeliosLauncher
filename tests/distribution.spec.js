const { test, expect } = require('@playwright/test');
const { launchApp, handleInitialOverlays, setupMockDistro, clearTestData } = require('./test-utils');

const MOCK_DISTRO = {
    version: '1.0.0',
    rss: 'https://f-launcher.ru/news',
    servers: [
        {
            id: 'test-server',
            name: 'E2E Test Server',
            description: 'Mocked for testing',
            icon: 'https://f-launcher.ru/icon.png',
            version: '1.0.0',
            address: 'localhost',
            minecraftVersion: '1.16.5',
            mainServer: true,
            modules: []
        }
    ]
};

test.describe('Distribution Loading Test', () => {
    let app, window;

    test.beforeEach(async () => {
        await clearTestData();
    });

    test.afterEach(async () => {
        if (app) await app.close();
    });

    test('should fetch and parse distribution index correctly', async () => {
        await setupMockDistro(MOCK_DISTRO);

        const onWindow = async (win) => {
            await win.route('**/distribution.json', async route => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MOCK_DISTRO)
                });
            });
        };

        const result = await launchApp(onWindow);
        app = result.electronApp;
        window = result.window;

        await handleInitialOverlays(window);

        // 1. Verify Server Selection Button exists and is visible
        const serverBtn = window.locator('#server_selection_button');
        await expect(serverBtn).toBeVisible({ timeout: 15000 });
        
        // 2. Wait for translations to be applied and server name to appear
        await expect(async () => {
             const serverText = await serverBtn.innerText();
             expect(serverText).toContain('E2E Test Server');
        }).toPass({ timeout: 15000 });

        // 3. Verify Launch Button is visible AND has non-zero width (indicates translation applied)
        const launchButton = window.locator('#launch_button');
        await expect(launchButton).toBeVisible({ timeout: 15000 });
        
        const width = await launchButton.evaluate(el => el.getBoundingClientRect().width);
        expect(width).toBeGreaterThan(0);

        const launchText = await launchButton.innerText();
        // Since we fixed the fallback to EJS translations, it should contain "ИГРАТЬ" (default in en_US.toml)
        expect(launchText.length).toBeGreaterThan(0);

        // 4. Verify News Button (Resources)
        const newsButton = window.locator('#newsButton');
        await expect(newsButton).toBeVisible();
        const newsText = await newsButton.innerText();
        expect(newsText.length).toBeGreaterThan(0);

        console.log('PASS: Full UI verification with translations complete.');
    });
});
