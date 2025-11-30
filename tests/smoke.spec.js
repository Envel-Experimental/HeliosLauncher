/**
 * Smoke Test: Application Startup
 *
 * Verifies that the application launches correctly, renders the initial UI,
 * loads the distribution index, and displays the "Play" button.
 * Fails if any renderer process errors are logged or if a fatal error overlay is shown.
 */

const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

test.describe('Application Startup Smoke Test', () => {
  let electronApp;

  // Set a higher timeout for the entire test suite to accommodate slow startups/network
  test.setTimeout(60000);

  test('should launch, load index, and display Play button without errors', async () => {
    // 1. Launch the application
    console.log('Launching application...');
    electronApp = await electron.launch({
      args: ['.'], // Point to the current directory (package.json main)
      timeout: 30000 // Allow extra time for slow environments
    });

    // 2. Hook into the Electron console to detect errors
    let errorLogged = false;
    electronApp.on('console', msg => {
      // Log everything for debugging the stuck state
      console.log(`[Renderer] [${msg.type()}] ${msg.text()}`);
      if (msg.type() === 'error') {
        errorLogged = true;
      }
    });

    // 3. Wait for the first window
    console.log('Waiting for first window...');
    const window = await electronApp.firstWindow();
    expect(window).toBeTruthy();

    // 4. Capture Metadata
    const title = await window.title();
    console.log(`App Title: "${title}"`);

    const size = await electronApp.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
            return win.getBounds();
        }
        return { width: 0, height: 0 };
    });
    console.log(`Window Size: ${size.width}x${size.height}`);

    // 5. Verify UI Elements
    console.log('Verifying UI elements...');

    // Check that body exists
    await window.locator('body').waitFor();

    // Wait for EITHER the "Play" button (success) OR the Fatal Error Overlay (failure)

    console.log('Waiting for Landing UI or Error Overlay...');

    const landingContainer = window.locator('#landingContainer');
    const errorOverlay = window.locator('#overlayContainer');
    const overlayTitle = window.locator('#overlayTitle');
    const overlayDesc = window.locator('#overlayDesc');

    const loadingContainer = window.locator('#loadingContainer');

    // Polling loop to check for states
    await expect.poll(async () => {
        // Log current visibility states
        const isLanding = await landingContainer.isVisible();
        const isError = await errorOverlay.isVisible();

        if (isError) {
            const title = await overlayTitle.innerText().catch(() => 'Unknown');
            const desc = await overlayDesc.innerText().catch(() => 'Unknown');
            console.log(`[Diagnostic] Overlay Visible. Title: "${title}", Desc: "${desc}"`);

            if (title.includes('Fatal Error') || title.includes('Startup Error') || title.includes('Ошибка')) {
                return 'error';
            }
        }

        if (isLanding) {
            return 'success';
        }

        return 'waiting';
    }, {
        timeout: 45000,
        message: 'Timed out waiting for Landing UI or Error Overlay'
    }).toBe('success');

    // Check buttons
    const launchButton = window.locator('#launch_button');
    const serverSelection = window.locator('#server_selection_button');

    await expect(launchButton).toBeVisible();
    await expect(serverSelection).toBeVisible();

    const buttonText = await launchButton.innerText();
    console.log(`Launch Button Text: "${buttonText}"`);

    // 6. Fail if any console errors were logged
    expect(errorLogged, 'Renderer process logged errors during startup').toBe(false);
  });

  test.afterEach(async () => {
    if (electronApp) {
      console.log('Closing application...');
      await electronApp.close();
    }
  });
});
