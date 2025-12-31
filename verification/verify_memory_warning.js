const { _electron: electron } = require('playwright');
const path = require('path');

(async () => {
    // Start the app
    const electronApp = await electron.launch({
        args: ['.'],
        executablePath: require('electron'), // Use the electron executable
        env: {
            ...process.env,
            // Mock memory to trigger low memory warning if possible?
            // Actually, we can't easily mock os.freemem without injecting code.
            // But we can verify the UI structure and that the app launches.
        }
    });

    const window = await electronApp.firstWindow();
    await window.waitForTimeout(5000); // Wait for app to load

    // Take screenshot
    await window.screenshot({ path: 'verification/landing.png' });

    await electronApp.close();
})();
