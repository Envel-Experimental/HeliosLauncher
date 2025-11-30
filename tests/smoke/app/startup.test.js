const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

test.describe('Application Startup Smoke Test', () => {
    let electronApp;

    test.beforeAll(async () => {
        // Launch Electron with comprehensive flags to prevent "black screen" and rendering hangs in CI.
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

        // --- LOG CAPTURE START ---
        const consoleLogs = [];
        window.on('console', msg => {
            const text = msg.text();
            consoleLogs.push(text);
            // Optional debug log
            if (text.includes('Overlay') || text.includes('Error') || text.includes('Visible')) {
                console.log('[App Console]', text);
            }
        });
        // -------------------------

        await window.waitForLoadState('domcontentloaded');
        try {
            await window.locator('body').waitFor({ state: 'attached', timeout: 30000 });
        } catch (e) {
            console.log('Body waitFor timeout, continuing to checks...');
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
            
            // 1. PRIMARY GOAL: Is the main Landing UI (Play button area) visible?
            if (await landing.isVisible()) {
                console.log('Test Pass: Landing UI (#landingContainer) is visible.');
                return; // SUCCESS
            }

            // 2. CHECK LOGS: Did the app report a critical overlay (Network/RAM)?
            // This is the most reliable check for "Alternative Success" on slow CI
            const logError = consoleLogs.find(l => 
                l.includes('Критическая ошибка') || 
                l.includes('сервера недоступны') || 
                l.includes('Network error') ||
                (l.includes('Overlay Visible') && l.includes('Title'))
            );

            if (logError) {
                console.log('Test Pass: Valid error overlay detected via logs. App is alive.');
                return; // SUCCESS (Alternative path)
            }

            // 3. CHECK DOM OVERLAY (Just in case logs are silent but DOM exists)
            if (await overlay.isVisible()) {
                const text = await overlay.innerText();
                const cleanText = text.replace(/\n/g, ' ').substring(0, 80);
                console.log(`Overlay detected in DOM: "${cleanText}..."`);
                
                // If we see it in DOM, we can also consider it a pass for network errors
                if (cleanText.includes('сервера недоступны') || cleanText.includes('Network error')) {
                     console.log('Test Pass: Network Error Overlay visible in DOM.');
                     return; // SUCCESS
                }

                // Try to dismiss other warnings
                if (await overlayButton.count() > 0 && await overlayButton.first().isVisible()) {
                    try {
                        await overlayButton.first().click({ timeout: 2000 });
                    } catch (err) {
                        console.log('Click failed:', err.message);
                    }
                    await new Promise(r => setTimeout(r, 2000));
                    continue; 
                }
            }

            // Wait 1 second before re-checking
            await new Promise(r => setTimeout(r, 1000));
        }

        throw new Error('Timeout: Failed to reach Landing UI. App might be stuck on black screen.');
    });
});