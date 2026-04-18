const { test, expect } = require('@playwright/test');
const { launchApp, handleInitialOverlays } = require('./test-utils');

test.describe('Download Logic and UI Feedback', () => {
    let app, window;

    test.beforeEach(async () => {
        const result = await launchApp();
        app = result.electronApp;
        window = result.window;
    });

    test.afterEach(async () => {
        if (app) await app.close();
    });

    test('should update progress bar and status text during download', async () => {
        await handleInitialOverlays(window);

        // Wait for landing view
        const launchButton = window.locator('#launch_button');
        await expect(launchButton).toBeVisible({ timeout: 30000 });

        // Mock dl:start to succeed immediately
        await window.evaluate(() => {
            const originalInvoke = window.ipcRenderer.invoke;
            window.ipcRenderer.invoke = (channel, ...args) => {
                if (channel === 'dl:start') return Promise.resolve();
                if (channel === 'sys:validateJava') return Promise.resolve({ path: 'java' });
                return originalInvoke(channel, ...args);
            };
        });

        // Click launch to start the process
        await launchButton.click();

        // Simulate progress events
        await window.evaluate(() => {
            const eventData = { type: 'download', progress: 68 };
            const callbacks = window.ipcRenderer._events['dl:progress'] || [];
            if (Array.isArray(callbacks)) {
                callbacks.forEach(cb => cb({}, eventData));
            } else if (typeof callbacks === 'function') {
                callbacks({}, eventData);
            }
        });

        // Verify UI reaction
        const progressLabel = window.locator('#launch_progress_label');
        await expect(progressLabel).toHaveText('68%');
        
        const detailsText = window.locator('#launch_details_text');
        await expect(detailsText).toContainText('Downloading Files');

        console.log('PASS: Download progress correctly reflected in UI.');
    });
});
