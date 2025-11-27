/**
 * Smoke Test: Application Startup
 *
 * Verifies that the application launches correctly, renders the initial UI,
 * and does not log any errors in the Renderer process.
 */

const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

test.describe('Application Startup Smoke Test', () => {
  let electronApp;

  test('should launch successfully and render UI without errors', async () => {
    // 1. Launch the application
    console.log('Launching application...');
    electronApp = await electron.launch({
      args: ['.'], // Point to the current directory (package.json main)
      timeout: 30000 // Allow extra time for slow environments
    });

    // 2. Hook into the Electron console to detect errors
    let errorLogged = false;
    electronApp.on('console', msg => {
      if (msg.type() === 'error') {
        console.error(`[Renderer Error] ${msg.text()}`);
        errorLogged = true;
      } else {
        console.log(`[Renderer Log] ${msg.text()}`);
      }
    });

    // 3. Wait for the first window
    console.log('Waiting for first window...');
    const window = await electronApp.firstWindow();
    expect(window).toBeTruthy();

    // 4. Capture Metadata
    const title = await window.title();
    console.log(`App Title: "${title}"`);

    // Use electronApp.evaluate to get window size from the main process
    // because window.evaluate is blocked in the renderer by uicore.js
    const size = await electronApp.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
            return win.getBounds();
        }
        return { width: 0, height: 0 };
    });
    console.log(`Window Size: ${size.width}x${size.height}`);

    // 5. Verify UI
    // Verify specific elements exist using Playwright locators (avoids eval)
    console.log('Verifying UI elements...');

    // Check that body exists
    await window.locator('body').waitFor();

    // Check for the main container or loading container to ensure content is loaded
    // app.ejs includes 'loadingContainer' and 'main'
    const loadingContainer = window.locator('#loadingContainer');
    const mainContainer = window.locator('#main');

    // Expect at least one of the main structural elements to be present
    await expect(loadingContainer.or(mainContainer).first()).toBeAttached();

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
