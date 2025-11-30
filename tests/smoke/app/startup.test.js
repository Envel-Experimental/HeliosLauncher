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
            timeout: 60000 // Increase launch timeout to 60s for CI environments
        });
    });

    test.afterAll(async () => {
        if (electronApp) {
            await electronApp.close();
        }
    });

    test('should launch, dismiss overlay if present, and ensure Landing UI is visible', async () => {
        const window = await electronApp.firstWindow();

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
        // Generic locator for a button inside the overlay (usually "Continue" or "OK")
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

            // 2. OBSTACLE: Is an Overlay blocking the view?
            if (await overlay.isVisible()) {
                const text = await overlay.innerText();
                console.log('Overlay detected:', text.substring(0, 50).replace(/\n/g, ' '));
                
                // Attempt to dismiss it by clicking the first available button inside
                if (await overlayButton.count() > 0 && await overlayButton.first().isVisible()) {
                    console.log('Attempting to click overlay button to dismiss...');
                    await overlayButton.first().click();
                    // Wait a moment for animation/fade-out
                    await new Promise(r => setTimeout(r, 1000));
                    continue; // Loop again to check if Landing appeared
                } else {
                    console.log('Warning: Overlay visible but no clickable button found.');
                }
            }

            // Wait 1 second before re-checking
            await new Promise(r => setTimeout(r, 1000));
        }

        // If we exit the loop, it means we never saw the Landing UI
        throw new Error('Timeout: Failed to reach Landing UI. App might be stuck on black screen or overlay could not be dismissed.');
    });
});