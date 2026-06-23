const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

test.describe('Application Startup Smoke Test', () => {
    let electronApp;

    // 2-minute timeout
    test.setTimeout(120000);

    test.beforeAll(async () => {
        electronApp = await electron.launch({ 
            args: [
                '.', 
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--use-gl=swiftshader',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
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

    test('should handle RAM warning and reach functional state', async () => {
        const window = await electronApp.firstWindow();
        
        window.on('console', msg => {
            const text = msg.text();
            console.log(`[App ${msg.type()}] ${text}`);
            
            // Enterprise Diagnostics: Fail fast on fatal errors
            if (msg.type() === 'error' && (text.includes('Error') || text.includes('TypeError') || text.includes('ReferenceError'))) {
                throw new Error(`Smoke Test Failed: Fatal app error detected: ${text}`);
            }
        });

        await window.waitForLoadState('domcontentloaded');

        const launchButton = window.locator('#launch_button');
        const serverSelect = window.locator('#server_selection_button');
        const overlay = window.locator('#overlayContainer');
        const continueButton = window.locator('#overlayAcknowledge');

        console.log('Starting UI loop...');
        const startTime = Date.now();
        // 90 seconds timeout for the loop
        const timeout = 90000;
        // Fail-fast check for bundle existence
        const fs = require('fs');
        const path = require('path');
        const bundlePath = path.join(__dirname, '..', 'app', 'dist', 'renderer.bundle.js');
        if (!fs.existsSync(bundlePath)) {
            throw new Error(`CRITICAL: renderer.bundle.js not found at ${bundlePath}. Did you run 'npm run bundle'?`);
        }

        const loginUsername = window.locator('#loginUsername');
        const loginOptions = window.locator('#loginOptionsContainer');
        
        // React UI Selectors
        const reactPlayButton = window.locator('.bottom-bar-center .play-button');
        const reactLoginInput = window.locator('#loginContainer .react-input');

        while (Date.now() - startTime < timeout) {
            
            // 0. FAILSAFE CHECK (if the app hung on start)
            const failsafeMarker = window.locator('text=Initialization is taking longer than expected');
            if (await failsafeMarker.count() > 0) {
                 // If failsafe marker is visible, it means the bundle didn't start in time
                 const statusText = await window.locator('#loadingStatusText').innerText();
                 throw new Error(`Startup Hang detected by Failsafe! Current Status: ${statusText}`);
            }

            // 1. SUCCESS CHECK
            if (await launchButton.isVisible() || await serverSelect.isVisible() || await loginUsername.isVisible() || await loginOptions.isVisible() || await reactPlayButton.isVisible() || await reactLoginInput.isVisible()) {
                console.log('PASS: Application reached a stable functional state (Landing or Login).');
                return;
            }

            // 2. OVERLAY PROCESSING
            if (await overlay.isVisible()) {
                const text = await overlay.innerText();
                const cleanText = text.replace(/\n/g, ' ');

                // Network error -> Also a win (app worked as intended)
                if (cleanText.includes('сервера недоступны') || cleanText.includes('Network error')) {
                    console.log('PASS: Critical Network Error confirmed.');
                    return; 
                }

                // Memory limit warning
                if (cleanText.includes('Технические проблемы') || cleanText.includes('оперативной памяти')) {
                    console.log('Overlay: Low RAM detected. Clicking "Continue"...');
                    
                    if (await continueButton.isVisible()) {
                        try {
                            await continueButton.click();
                            
                            // Wait for the overlay to disappear
                            try {
                                await expect(overlay).toBeHidden({ timeout: 5000 });
                                console.log('PASS: Low RAM overlay dismissed. App is interactive!');
                                // EXIT WITH SUCCESS. Button was clicked and app reacted.
                                // No need to wait for files to download for the Smoke test.
                                return;
                            } catch (e) {
                                console.log('Warning: Overlay stuck, trying loop again...');
                            }
                        } catch (e) {
                            console.log('Click failed:', e.message);
                        }
                    }
                }
            }

            // 3. LICENSE AGREEMENTS PROCESSING
            const agreementContainer = window.locator('#agreementContainer');
            if (await agreementContainer.isVisible()) {
                console.log('Agreement screen detected. Accepting...');
                const checkbox = window.locator('#agreementCheckbox');
                const button = window.locator('#agreementButton');
                if (!(await checkbox.isChecked())) {
                    console.log('Checking agreement checkbox...');
                    await checkbox.check({ force: true });
                    await window.waitForTimeout(200);
                }
                if (await button.isVisible() && !(await button.isDisabled())) {
                    console.log('Clicking agreement button...');
                    await button.click();
                    await window.waitForTimeout(500);
                }
            }

            const p2pAgreementContainer = window.locator('#p2pAgreementContainer');
            if (await p2pAgreementContainer.isVisible()) {
                console.log('P2P Agreement screen detected. Enabling...');
                const enableBtn = window.locator('#p2pAgreementEnableButton');
                if (await enableBtn.isVisible()) {
                    await enableBtn.click();
                    await window.waitForTimeout(500);
                }
            }

            await new Promise(r => setTimeout(r, 500));
        }

        throw new Error('Timeout: App did not reach a stable state.');
    });
});