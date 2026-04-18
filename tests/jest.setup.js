jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => require('path').join(__dirname, '..', 'test-data')),
    getVersion: jest.fn(() => '1.0.0'),
  },
  ipcRenderer: {
    send: jest.fn(),
    on: jest.fn(),
    invoke: jest.fn(),
  },
  contextBridge: {
    exposeInMainWorld: jest.fn(),
  },
  shell: {
    openExternal: jest.fn(),
  },
}));

jest.mock('@electron/remote', () => ({
  app: {
    getPath: jest.fn(() => require('path').join(__dirname, '..', 'test-data')),
  },
}), { virtual: true });

jest.mock('@sentry/electron/main', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}), { virtual: true });

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}), { virtual: true });
