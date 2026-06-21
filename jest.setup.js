import '@testing-library/jest-dom';

// Mock electron version for Sentry
if (!process.versions) process.versions = {};
process.versions.electron = '30.0.0';

// Mock global objects used by the React UI
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
    openExternal: jest.fn()
  }
};
