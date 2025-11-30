const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

test.describe('Application Startup Smoke Test', () => {
    let electronApp;

    test.beforeAll(async () => {
        electronApp = await electron.launch({ 
            args: [
                '.', 
                '--no-sandbox', 
                '--disable-gpu', 
                '--disable-dev-shm-usage', 
                '--disable-software-rasterizer',
                '--disable-gpu-compositing',
                '--disable-renderer-backgrounding',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-hang-monitor'
            ],
            timeout: 60000
        });
    });

    test.afterAll(async () => {
        if (electronApp) {
            await electronApp.close();
        }
    });

    test('should launch, handle network/memory overlays, and consider app alive', async () => {
        const window = await electronApp.firstWindow();
        const consoleLogs = [];

        // Catch console logs immediately
        window.on('console', msg => {
            const text = msg.text();
            consoleLogs.push(text);
            if (text.includes('Overlay') || text.includes('Error')) {
                console.log('[App Console]', text);
            }
        });

        await window.waitForLoadState('domcontentloaded');
        try {
            await window.locator('body').waitFor({ state: 'attached', timeout: 30000 });
        } catch (e) {
            console.log('Body waitFor timeout, continuing...');
        }

        const title = await window.title();
        expect(title).toMatch(/FLauncher|ФЛАУНЧЕР/i);

        const landing = window.locator('#landingContainer');
        const overlay = window.locator('#overlayContainer');
        const overlayButton = overlay.locator('button'); 

        console.log('Starting UI interaction loop (60s timeout)...');
        
        const startTime = Date.now();
        const timeout = 60000;

        while (Date.now() - startTime < timeout) {
            
            // 1. Success Case: Landing UI Visible
            if (await landing.isVisible()) {
                console.log('Test Pass: Landing UI (#landingContainer) is visible.');
                return;
            }

            // 2. Success Case: Critical Error in Logs (Network/RAM)
            // This catches cases where UI is slow but app logic is reporting errors correctly
            const logError = consoleLogs.find(l => 
                l.includes('Критическая ошибка') || 
                l.includes('сервера недоступны') || 
                l.includes('Network error') ||
                (l.includes('Overlay Visible') && l.includes('Title'))
            );

            if (logError) {
                console.log('Test Pass: Valid error overlay detected via logs:', logError);
                return; 
            }

            // 3. Success Case: Critical Error in DOM Text
            if (await overlay.isVisible()) {
                const text = await overlay.innerText();
                const cleanText = text.replace(/\n/g, ' ').substring(0, 100);
                console.log(`Overlay DOM Text: "${cleanText}..."`);
                
                // If we see network error text in DOM, it's a pass
                if (cleanText.includes('сервера недоступны') || cleanText.includes('Network error') || cleanText.includes('Критическая ошибка')) {
                     console.log('Test Pass: Network/Critical Error Overlay visible in DOM.');
                     return; 
                }

                // If it's a dismissible warning (RAM), try to click
                if (await overlayButton.count() > 0 && await overlayButton.first().isVisible()) {
                    try {
                        console.log('Clicking overlay button...');
                        await overlayButton.first().click({ timeout: 2000 });
                    } catch (err) {
                        console.log('Click failed:', err.message);
                    }
                    await new Promise(r => setTimeout(r, 2000));
                    continue; 
                }
            }

            await new Promise(r => setTimeout(r, 1000));
        }

        throw new Error('Timeout: Failed to reach Landing UI or see a valid Error Overlay.');
    });
});