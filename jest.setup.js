import '@testing-library/jest-dom';

// Polyfill setImmediate for jsdom
if (typeof global.setImmediate === 'undefined') {
  global.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
  global.clearImmediate = clearTimeout;
}

// Mock electron version for Sentry
if (!process.versions) process.versions = {};
process.versions.electron = '30.0.0';

// Mock global objects used by the React UI
if (typeof window !== 'undefined') {
  window.Lang = {
    queryJS: jest.fn((key, fallback) => fallback)
  };

  window.ConfigManager = {
    getAuthAccounts: jest.fn(() => ({ 'test-uuid': { uuid: 'test-uuid', username: 'TestUser' } })),
    getSelectedAccount: jest.fn(() => ({ uuid: 'test-uuid', username: 'TestUser' })),
    getSelectedServer: jest.fn(() => 'test-server-id'),
    setSelectedServer: jest.fn(),
    save: jest.fn(),
    getDataDirectory: jest.fn(() => '/mock/data/dir'),
  };

  window.DistroAPI = {
    getDistribution: jest.fn(() => Promise.resolve({
      servers: [
        { rawServer: { id: 'test-server-id', name: 'Test Server', minecraftVersion: '1.20.1' } }
      ],
      getServerById: jest.fn()
    })),
    getDistributionSync: jest.fn(() => ({
      getServerById: jest.fn()
    }))
  };

  window.HeliosAPI = {
    shell: {
      openPath: jest.fn(),
      openExternal: jest.fn(),
      beep: jest.fn()
    },
    ipc: {
      invoke: jest.fn(),
      send: jest.fn(),
      on: jest.fn(),
    },
    system: {
      getEnv: jest.fn().mockReturnValue({})
    }
  };
}

jest.mock('electron', () => {
  const os = require('os');
  const path = require('path');
  const mockPath = path.join(os.tmpdir(), 'mock-path');
  return {
    app: {
      getAppPath: jest.fn(() => path.join(os.tmpdir(), 'mock-app-path')),
      getPath: jest.fn(() => mockPath),
      getVersion: jest.fn(() => '1.0.0'),
      isPackaged: false,
      isReady: jest.fn().mockReturnValue(false)
    },
    ipcMain: {
      on: jest.fn(),
      handle: jest.fn(),
      emit: jest.fn(),
    },
    ipcRenderer: {
      on: jest.fn(),
      send: jest.fn(),
      invoke: jest.fn()
    },
    shell: {
      openExternal: jest.fn(),
      beep: jest.fn()
    }
  };
}, { virtual: true });

jest.mock('@sentry/electron/main', () => {
  return {
    init: jest.fn(),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    setTag: jest.fn(),
    setExtra: jest.fn(),
  };
}, { virtual: true });
