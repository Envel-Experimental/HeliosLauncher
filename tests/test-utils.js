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
async function clearTestData() {
    if (fs.existsSync(TEST_USER_DATA)) {
        try {
            fs.rmSync(TEST_USER_DATA, { recursive: true, force: true });
        } catch (e) {
            console.log(`Warning: Could not clear test directory: ${e.message}`);
        }
    }
}

async function setupDummyConfig() {
    console.log('setupDummyConfig: Setting up config...');
    if (!fs.existsSync(FOXFORD_DATA_PATH)) {
        fs.mkdirSync(FOXFORD_DATA_PATH, { recursive: true });
    }
    const dummyConfig = {
        settings: {
            game: { resWidth: 1280, resHeight: 720, fullscreen: false, autoConnect: true, launchDetached: false },
            launcher: { allowPrerelease: false, dataDirectory: FOXFORD_DATA_PATH, totalRAMWarningShown: true },
            deliveryOptimization: { localOptimization: true, globalOptimization: true, p2pUploadEnabled: true, p2pUploadLimit: 5, p2pOnlyMode: false },
            p2pPromptShown: true
        },
        clientToken: "test-client-token",
        selectedServer: "TestServer",
        selectedAccount: "test-uuid",
        authenticationDatabase: {
            "test-uuid": {
                type: "mojang",
                accessToken: "test-access-token",
                username: "TestUser@example.com",
                uuid: "test-uuid",
                displayName: "TestUser"
            }
        },
        modConfigurations: {},
        javaConfig: {
            minRAM: "1G",
            maxRAM: "2G"
        }
    };

    fs.writeFileSync(path.join(FOXFORD_DATA_PATH, 'config.json'), JSON.stringify(dummyConfig, null, 2));
}

/**
 * Write a mock distribution index directly to the local cache.
 */
async function setupMockDistro(distroData) {
    if (!fs.existsSync(FOXFORD_DATA_PATH)) {
        fs.mkdirSync(FOXFORD_DATA_PATH, { recursive: true });
    }
    const distroPath = path.join(FOXFORD_DATA_PATH, 'distribution.json');
    const distroDevPath = path.join(FOXFORD_DATA_PATH, 'distribution_dev.json');
    const content = JSON.stringify(distroData, null, 4);
    fs.writeFileSync(distroPath, content);
    fs.writeFileSync(distroDevPath, content);
    console.log(`[TestUtils] Mock distribution written to: ${distroPath} and ${distroDevPath}`);
}

/**
 * Launch the HeliosLauncher application
 */
async function launchApp(onWindow = null, resetConfig = true) {
    if (resetConfig) {
        await setupDummyConfig();
    }

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
            APPDATA: TEST_USER_DATA, // Redirect pathutil.js
            NODE_ENV: 'test', // Enable SecurityUtils bypass
            HELIOS_DEV_MODE: 'true' // Use local distribution.json
        },
        timeout: 60000
    });

    console.log('launchApp: Waiting for window...');

    if (onWindow) {
        electronApp.on('window', async (win) => {
            await onWindow(win);
        });
    }

    // Capture Main Process logs immediately
    const mainProcess = electronApp.process();
    mainProcess.stdout.on('data', (data) => {
        console.log(`[Main] STDOUT: ${data.toString()}`);
    });
    mainProcess.stderr.on('data', (data) => {
        console.log(`[Main] STDERR: ${data.toString()}`);
    });

    electronApp.on('window', async (window) => {
        window.on('console', msg => {
            console.log(`[App] ${msg.type().toUpperCase()}: ${msg.text()}`);
        });
        window.on('pageerror', exception => {
            console.log(`[App] PAGE UNCAUGHT ERROR: ${exception.stack || exception}`);
        });
        window.on('dialog', async dialog => {
            console.log(`[App] DIALOG: ${dialog.message()}`);
            await dialog.dismiss();
        });
        window.on('requestfailed', request => {
            console.log(`[App] REQUEST FAILED: ${request.url()} - ${request.failure()?.errorText}`);
        });
    });

    const window = await electronApp.firstWindow();
    console.log('launchApp: Window acquired!');
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
    // Wait for the UI to be ready (splash screen hidden)
    console.log('openSettings: Waiting for splash screen to disappear...');
    const loadingOverlay = window.locator('#loadingContainer');
    await loadingOverlay.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {
        console.warn('openSettings: Splash screen did not disappear in time, proceeding anyway.');
    });

    const settingsBtn = window.locator('#settingsMediaButton');
    console.log('openSettings: Waiting for settings button...');
    try {
        await settingsBtn.waitFor({ state: 'visible', timeout: 30000 });
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

/**
 * Delete a specific file in an instance directory to simulate corruption.
 */
function deleteInstanceFile(serverId, relativePath) {
    const filePath = path.join(FOXFORD_DATA_PATH, 'instances', serverId, relativePath);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[TestUtils] Deleted file for corruption test: ${filePath}`);
    }
}

/**
 * Verify a file exists in an instance directory.
 */
function verifyInstanceFile(serverId, relativePath) {
    const filePath = path.join(FOXFORD_DATA_PATH, 'instances', serverId, relativePath);
    return fs.existsSync(filePath);
}

module.exports = {
    launchApp,
    handleInitialOverlays,
    openSettings,
    switchSettingsTab,
    setupMockDistro,
    setupDummyConfig,
    clearTestData,
    deleteInstanceFile,
    verifyInstanceFile,
    TEST_USER_DATA,
    FOXFORD_DATA_PATH
};
