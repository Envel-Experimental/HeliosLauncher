const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');
const path = require('path');

test('Diagnostic Startup Test', async () => {
    const electronApp = await electron.launch({ 
        args: ['.', '--no-sandbox'],
        timeout: 60000
    });

    const window = await electronApp.firstWindow();
    
    window.on('console', msg => {
        console.log(`[App ${msg.type()}] ${msg.text()}`);
    });

    await window.waitForLoadState('domcontentloaded');

    console.log('Checking containers...');
    const containers = [
        '#loadingContainer',
        '#welcomeContainer',
        '#loginOptionsContainer',
        '#landingContainer',
        '#overlayContainer'
    ];

    for (const id of containers) {
        const isVisible = await window.locator(id).isVisible();
        console.log(`${id} is visible: ${isVisible}`);
    }

    const html = await window.content();
    require('fs').writeFileSync('dom-snapshot.html', html);
    console.log('DOM snapshot saved to dom-snapshot.html');

    await electronApp.close();
});
