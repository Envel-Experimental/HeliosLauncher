const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Common utilities for HeliosLauncher E2E tests
 */

const TEST_USER_DATA = path.join(process.cwd(), 'temp_test_user_data');
const FOXFORD_DATA_PATH = path.join(TEST_USER_DATA, '.foxford');

/**
 * Create a dummy config to bypass first-launch screens and provide a test account
 */
async function setupDummyConfig() {
    console.log('setupDummyConfig: Creating isolated test environment...');
    if (fs.existsSync(TEST_USER_DATA)) {
        try {
            fs.rmSync(TEST_USER_DATA, { recursive: true, force: true });
        } catch (e) {
            console.log(`Warning: Could not clear test directory: ${e.message}`);
        }
    }
    if (!fs.existsSync(FOXFORD_DATA_PATH)) {
        fs.mkdirSync(FOXFORD_DATA_PATH, { recursive: true });
    }
    const dummyConfig = {
        settings: {
            game: { resWidth: 1280, resHeight: 720, fullscreen: false, autoConnect: true, launchDetached: true },
            launcher: { allowPrerelease: false, dataDirectory: FOXFORD_DATA_PATH, totalRAMWarningShown: true },
            deliveryOptimization: { localOptimization: true, globalOptimization: true, p2pUploadEnabled: true, p2pUploadLimit: 5, p2pOnlyMode: false },
            p2pPromptShown: true
        },
        clientToken: "test-client-token",
        selectedServer: "test-server",
        selectedAccount: "test-uuid",
        authenticationDatabase: {
            "test-uuid": {
                type: "mojang",
                accessToken: "test-access-token",
                username: "TestUser@example.com",
                uuid: "test-uuid",
                displayName: "TestUser"
            },
            "test-uuid-2": {
                type: "mojang",
                accessToken: "test-access-token-2",
                username: "SecondaryUser@example.com",
                uuid: "test-uuid-2",
                displayName: "SecondaryUser"
            }
        },
        modConfigurations: [],
        javaConfig: {}
    };

    fs.writeFileSync(path.join(FOXFORD_DATA_PATH, 'config.json'), JSON.stringify(dummyConfig, null, 2));
}

/**
 * Launch the HeliosLauncher application
 */
async function launchApp() {
    await setupDummyConfig();

    console.log('launchApp: Launching Electron...');
    const electronApp = await electron.launch({
        args: [
            '.',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--use-gl=swiftshader',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-hang-monitor',
            '--user-data-dir=' + TEST_USER_DATA
        ],
        env: {
            ...process.env,
            APPDATA: TEST_USER_DATA // Redirect pathutil.js
        },
        timeout: 60000
    });

    console.log('launchApp: Waiting for first window...');
    const window = await electronApp.firstWindow();
    console.log('launchApp: Window acquired!');
    
    // Redirect app console to test console for easier debugging
    window.on('console', msg => {
        const text = msg.text();
        if (msg.type() === 'error' || text.includes('Error') || text.includes('fatal')) {
            console.log(`[App] ${msg.type().toUpperCase()}: ${text}`);
        }
    });

    return { electronApp, window };
}

/**
 * Dismiss common overlays like RAM warning or P2P prompt
 * and handle Welcome screen if it somehow appeared.
 */
async function handleInitialOverlays(window) {
    console.log('Handling initial overlays/screens...');
    
    // Wait for app to initialize
    await window.waitForLoadState('domcontentloaded');

    const welcomeBtn = window.locator('#welcomeButton');
    if (await welcomeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log('Welcome screen detected, clicking continue...');
        await welcomeBtn.click();
    }

    const overlay = window.locator('#overlayContainer');
    const continueButton = window.locator('#overlayAcknowledge');

    // Loop a few times to catch sequential overlays
    for (let i = 0; i < 3; i++) {
        if (await overlay.isVisible({ timeout: 2000 }).catch(() => false)) {
            const text = await overlay.innerText();
            console.log(`Overlay detected: ${text.substring(0, 50)}...`);
            
            if (await continueButton.isVisible()) {
                await continueButton.click();
            }
            await window.waitForTimeout(500);
        }
    }
}

/**
 * Navigate to Settings
 */
async function openSettings(window) {
    const settingsBtn = window.locator('#settingsMediaButton');
    console.log('openSettings: Waiting for settings button...');
    try {
        await settingsBtn.waitFor({ state: 'visible', timeout: 10000 });
        await settingsBtn.click();
        await window.waitForSelector('#settingsContainer', { state: 'visible' });
        console.log('openSettings: Settings opened!');
    } catch (e) {
        console.log('openSettings: Failed to open settings. Button visible?', await settingsBtn.isVisible());
        throw e;
    }
}

/**
 * Switch settings tab
 */
async function switchSettingsTab(window, tabId) {
    const tab = window.locator(`.settingsNavItem[rSc="${tabId}"]`);
    await tab.click();
    await window.waitForSelector(`#${tabId}`, { state: 'visible' });
}

module.exports = {
    launchApp,
    handleInitialOverlays,
    openSettings,
    switchSettingsTab,
    TEST_USER_DATA
};
