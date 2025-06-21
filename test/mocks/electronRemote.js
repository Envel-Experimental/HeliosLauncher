// test/mocks/electronRemote.js
export const app = {
    getPath: jest.fn(name => {
        if (name === 'userData') {
            return '/mocked/userData/path'
        }
        return `/mocked/path/${name}`
    }),
    getName: jest.fn(() => 'FLauncherTest'),
    getVersion: jest.fn(() => '0.0.0-test'),
}

export const dialog = {
    showErrorBox: jest.fn(),
}

export const require = jest.fn() // If @electron/remote.require is used

// You can add other properties/methods of @electron/remote you use
// For example, if you use `BrowserWindow` from remote:
// export const BrowserWindow = jest.fn().mockImplementation(() => ({
//   loadURL: jest.fn(),
//   webContents: {
//     on: jest.fn(),
//     send: jest.fn(),
//     openDevTools: jest.fn(),
//   },
//   on: jest.fn(),
//   show: jest.fn(),
//   hide: jest.fn(),
//   close: jest.fn(),
// }));

export default {
    app,
    dialog,
    require,
    // BrowserWindow, // if added above
}
