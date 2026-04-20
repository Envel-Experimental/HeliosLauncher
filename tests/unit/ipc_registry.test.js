let handlers = {};
let ipcMainMock = {
    handle: jest.fn((channel, listener) => {
        handlers[channel] = listener;
    }),
    on: jest.fn()
};

jest.mock('electron', () => ({
    ipcMain: ipcMainMock,
    app: {
        getVersion: () => '1.0.0',
        getPath: () => '/mock/path',
        whenReady: () => Promise.resolve(),
        isPackaged: false
    },
    dialog: {
        showOpenDialog: jest.fn()
    },
    shell: {
        openPath: jest.fn()
    }
}), { virtual: true });

describe('IpcRegistry Connectivity Check Tests', () => {
    beforeEach(() => {
        handlers = {};
        jest.clearAllMocks();
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.resetModules();
    });

    test('connectivity:check should return true for both services when fetch succeeds', async () => {
        const IpcRegistryModule = require('../../app/main/IpcRegistry');
        IpcRegistryModule.init();

        const handler = handlers['connectivity:check'];
        expect(handler).toBeDefined();

        global.fetch.mockResolvedValue({ ok: true });

        const result = await handler();

        expect(result).toEqual({
            github: true,
            mojang: true
        });

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(global.fetch).toHaveBeenCalledWith('https://github.com', expect.objectContaining({ method: 'HEAD' }));
        expect(global.fetch).toHaveBeenCalledWith('https://minecraft.net', expect.objectContaining({ method: 'HEAD' }));
    });

    test('connectivity:check should return false for a service when fetch fails', async () => {
        const IpcRegistryModule = require('../../app/main/IpcRegistry');
        IpcRegistryModule.init();

        const handler = handlers['connectivity:check'];

        global.fetch.mockImplementation(async (url) => {
            if (url.includes('github')) {
                return { ok: true };
            } else {
                return { ok: false };
            }
        });

        const result = await handler();

        expect(result).toEqual({
            github: true,
            mojang: false
        });
    });

    test('connectivity:check should handle network exceptions gracefully', async () => {
        const IpcRegistryModule = require('../../app/main/IpcRegistry');
        IpcRegistryModule.init();

        const handler = handlers['connectivity:check'];

        global.fetch.mockRejectedValue(new Error('Network error'));

        const result = await handler();

        expect(result).toEqual({
            github: false,
            mojang: false
        });
    });
});
