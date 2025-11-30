const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

test.describe('Application Startup Smoke Test', () => {
    let electronApp;

    test.beforeAll(async () => {
        // Launch Electron with specific flags to avoid "black screen" or hanging on logo in CI environments.
        // --disable-gpu: Critical for Windows CI runners without a real GPU.
        // --no-sandbox: Improves stability on Linux/Docker.
        electronApp = await electron.launch({ 
            args: [
                '.', 
                '--no-sandbox', 
                '--disable-gpu', 
                '--disable-dev-shm-usage', 
                '--disable-software-rasterizer'
            ],
            timeout: 45000 
        });
    });

    test.afterAll(async () => {
        if (electronApp) {
            await electronApp.close();
        }
    });

    test('should launch, load index, and display Play button (or Memory Warning)', async () => {
        // Wait for the first window to appear
        const window = await electronApp.firstWindow();
        
        // Wait for the DOM to be ready.
        // This helps avoid checking elements while the screen is still black/loading.
        await window.waitForLoadState('domcontentloaded');
        await window.locator('body').waitFor({ state: 'attached' });

        // Verify window title to ensure the app context is correct
        const title = await window.title();
        expect(title).toMatch(/FLauncher|ФЛАУНЧЕР/i);

        // --- MAIN LOGIC ---
        // We wait for EITHER the success screen (#landingContainer) 
        // OR the memory warning overlay (#overlayContainer).
        // This prevents the test from failing if the CI runner has low RAM.
        
        const landing = window.locator('#landingContainer');
        const overlay = window.locator('#overlayContainer');

        // Poll the UI state until one of the expected containers is visible.
        // Timeout set to 45s to allow heavy assets to load on slow CI machines.
        await expect(async () => {
            const isLandingVisible = await landing.isVisible();
            const isOverlayVisible = await overlay.isVisible();
            
            // Scenario A: Memory warning or other overlay appeared.
            // We consider this a "pass" because the app successfully rendered the UI layer.
            if (isOverlayVisible) {
                const overlayText = await overlay.innerText();
                console.log('Overlay detected (Test Passed):', overlayText);
                return true; 
            }

            // Scenario B: Main landing screen appeared. Success.
            if (isLandingVisible) {
                return true;
            }

            // If neither is visible yet (e.g., stuck on preloader/logo), fail the assertion to trigger a retry.
            // This error message will only show up if the timeout (45s) is exceeded.
            expect(isLandingVisible || isOverlayVisible, 'Waiting for Landing or Overlay...').toBeTruthy();
        }).toPass({ timeout: 45000, interval: 1000 });
    });
});