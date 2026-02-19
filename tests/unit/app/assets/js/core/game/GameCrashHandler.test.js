const GameCrashHandler = require('@app/assets/js/core/game/GameCrashHandler');
const ConfigManager = require('@app/assets/js/configmanager');

jest.mock('@app/assets/js/configmanager');
jest.mock('@app/assets/js/core/util/LoggerUtil', () => ({
    LoggerUtil: {
        getLogger: jest.fn().mockReturnValue({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        })
    }
}));
jest.mock('@app/assets/js/preloader', () => ({
    sendToSentry: jest.fn()
}));
jest.mock('@app/assets/js/crash-handler');
jest.mock('@app/assets/js/dropinmodutil');
jest.mock('@app/assets/js/langloader', () => ({
    queryJS: jest.fn((key) => key)
}));
jest.mock('electron', () => ({
    shell: {
        openExternal: jest.fn()
    }
}));

describe('GameCrashHandler', () => {
    let mockWindow;

    beforeEach(() => {
        mockWindow = {
            webContents: {
                send: jest.fn()
            }
        };
        jest.clearAllMocks();
    });

    it('should initialize correctly', () => {
        const handler = new GameCrashHandler(mockWindow, 12345, 1);
        expect(handler.window).toBe(mockWindow);
        expect(handler.crashProcess).toBe(12345);
        expect(handler.serverHash).toBe(1);
    });

    // Since the actual analyze logic involves checking file contents and reading logs which is IO heavy and hard to mock 
    // without seeing the implementation, we will focus on the structure for now.
    // Assuming analyze() primarily checks exit codes and sends IPC events.

    // If analyze is not easily testable without extensive FS mocks, we might skip deep traversal for now
    // and just test the constructor and simpler methods if any.
});
