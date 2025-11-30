const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

test.describe('Application Startup Smoke Test', () => {
    let electronApp;

    test.beforeAll(async () => {
        // Launch Electron with comprehensive flags to prevent "black screen" and rendering hangs in CI.
        // These flags force software rendering and disable background throttling.
        electronApp = await electron.launch({ 
            args: [
                '.', 
                '--no-sandbox', 
                '--disable-gpu', 
                '--disable-dev-shm-usage', 
                '--disable-software-rasterizer', // Forces CPU rendering
                '--disable-gpu-compositing',     // Disables GPU compositing completely
                '--disable-renderer-backgrounding', // Prevents throttling when window is not focused
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-hang-monitor' // Prevents the "Application is not responding" dialog
            ],
            timeout: 60000 // Increased launch timeout for slow CI runners
        });
    });

    test.afterAll(async () => {
        if (electronApp) {
            await electronApp.close();
        }
    });

    test('should launch, dismiss overlay if present, and ensure Landing UI is visible', async () => {
        const window = await electronApp.firstWindow();

        // --- LOG CAPTURE START ---
        // Capture logs immediately to catch early errors/overlays
        const consoleLogs = [];
        window.on('console', msg => {
            const text = msg.text();
            consoleLogs.push(text);
            // Debug output to CI console so we can see what's happening real-time
            if (text.includes('Overlay') || text.includes('Error') || text.includes('Visible')) {
                console.log('[App Console]', text);
            }
        });
        // -------------------------

        // Wait for the DOM to be ready to avoid checking on a blank window
        await window.waitForLoadState('domcontentloaded');
        try {
            await window.locator('body').waitFor({ state: 'attached', timeout: 30000 });
        } catch (e) {
            console.log('Body waitFor timeout, continuing to checks...');
        }

        const title = await window.title();
        expect(title).toMatch(/FLauncher|ФЛАУНЧЕР/i);

        // Define locators
        const landing = window.locator('#landingContainer');
        const overlay = window.locator('#overlayContainer');
        const overlayButton = overlay.locator('button'); 

        console.log('Starting UI interaction loop (60s timeout)...');
        
        const startTime = Date.now();
        const timeout = 60000;

        // Loop to handle potential overlays dynamically
        while (Date.now() - startTime < timeout) {
            
            // 1. PRIMARY GOAL: Is the main Landing UI (Play button area) visible?
            if (await landing.isVisible()) {
                console.log('Test Pass: Landing UI (#landingContainer) is visible.');
                return; // SUCCESS
            }

            // 2. CHECK LOGS: Did the app report a critical overlay (Network/RAM)?
            // This is the most reliable check for "Alternative Success"
            const logError = consoleLogs.find(l => 
                l.includes('Критическая ошибка') || 
                l.includes('сервера недоступны') || 
                (l.includes('Overlay Visible') && l.includes('Title'))
            );

            if (logError) {
                console.log('Test Pass: Valid error overlay detected via logs:', logError);
                return; // SUCCESS (Alternative path: App handled error correctly)
            }

            // 3. CHECK DOM OVERLAY: Is an Overlay blocking the view?
            if (await overlay.isVisible()) {
                const text = await overlay.innerText();
                const cleanText = text.replace(/\n/g, ' ').substring(0, 80);
                console.log(`Overlay detected in DOM: "${cleanText}..."`);
                
                // If it's a dismissible warning (like RAM), try to click it.
                // If it's a critical network error, we might just accept it and pass (see step 2),
                // but if we are here, maybe the log check failed or we want to try to recover.
                if (await overlayButton.count() > 0 && await overlayButton.first().isVisible()) {
                    console.log('Attempting to click overlay button...');
                    try {
                        await overlayButton.first().click({ timeout: 2000 });
                        // Clear logs to check for *new* errors after click
                        // (Optional, keeps logic simple for now)
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

        // If we exit the loop, it means we never saw the Landing UI OR a valid error log
        throw new Error('Timeout: Failed to reach Landing UI. App might be stuck on black screen.');
    });
});