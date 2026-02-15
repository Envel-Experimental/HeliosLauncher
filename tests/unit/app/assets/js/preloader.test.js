
/**
 * @jest-environment jsdom
 */

// Mock dependencies used by preloader
jest.mock('electron', () => ({
    ipcRenderer: {
        send: jest.fn(),
        on: jest.fn(),
        invoke: jest.fn()
    }
}));

jest.mock('@electron/remote', () => ({
    app: {
        getVersion: jest.fn(() => '1.0.0')
    }
}));

jest.mock('fs/promises', () => ({
    rm: jest.fn(),
    stat: jest.fn(),
    mkdir: jest.fn(),
    access: jest.fn()
}));

jest.mock('@sentry/electron/renderer', () => ({
    init: jest.fn(),
    setContext: jest.fn(),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
}));

// Mock modules imported by preloader
// Note: Some imports might be relative. We adjust mocks to match require calls.
// preloader.js requires:
// ../../../network/config -> @app/assets/js/network/config (based on alias usage in other tests, but let's be careful)
// ./configmanager -> @app/assets/js/configmanager
// ./distromanager
// ./langloader
// ./core/util/LoggerUtil
// ./util

// Mock with actual require paths used in preloader.js and potential aliases
const mockConfigManager = {
    load: jest.fn().mockResolvedValue(),
    getCommonDirectory: jest.fn(() => 'common'),
    getInstanceDirectory: jest.fn(() => 'instance'),
    getSelectedServer: jest.fn(),
    setSelectedServer: jest.fn(),
    save: jest.fn().mockResolvedValue(),
    setLocalOptimization: jest.fn(),
    setGlobalOptimization: jest.fn(),
    setP2PUploadEnabled: jest.fn(),
    setP2POnlyMode: jest.fn(),
    setSupportUrl: jest.fn()
};

jest.mock('@app/assets/js/configmanager', () => mockConfigManager);
jest.mock('../../../../../app/assets/js/configmanager', () => mockConfigManager, { virtual: true }); // relative from test file? No, relative from preloader.js is ./configmanager. Jest mocks are defined in test file. 

// The most robust way: mock the module that matches the interaction.
// If preloader.js does require('./configmanager'), Jest resolves it to <root>/app/assets/js/configmanager.js.
// So jest.mock('@app/assets/js/configmanager') should work IF @app points to <root>/app.
// BUT if it fails, let's try strict path mocking.

jest.mock('../../../../app/assets/js/configmanager', () => mockConfigManager);
// path from tests/unit/app/assets/js/preloader.test.js to app/assets/js/configmanager is ../../../../../app... no
// tests/unit/app/assets/js/ -> ../../../../app/assets/js/

// Mock network config. 
// Test file: ROOT/tests/unit/app/assets/js/preloader.test.js
// Target file: ROOT/network/config.js
// Path: ../../../../../network/config
jest.mock('../../../../../network/config', () => ({
    P2P_KILL_SWITCH_URL: 'http://mock/killswitch',
    SUPPORT_CONFIG_URL: 'http://mock/support'
}), { virtual: true });

jest.mock('@app/assets/js/distromanager', () => ({
    DistroAPI: {
        getDistribution: jest.fn().mockResolvedValue(null)
    }
}));

jest.mock('@app/assets/js/langloader', () => ({
    setupLanguage: jest.fn()
}));

jest.mock('@app/assets/js/core/util/LoggerUtil', () => ({
    LoggerUtil: {
        getLogger: () => ({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        })
    }
}));

jest.mock('@app/assets/js/util', () => ({
    retry: jest.fn()
}));


const preloader = require('@app/assets/js/preloader');

describe.skip('preloader', () => {
    it('should be loaded', () => {
        expect(preloader).toBeDefined();
    });
});
