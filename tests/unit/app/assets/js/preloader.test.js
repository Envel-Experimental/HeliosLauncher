jest.mock('@sentry/electron/renderer', () => ({
    init: jest.fn(),
    setContext: jest.fn(),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
}));

jest.mock('@electron/remote', () => ({
    app: {
        getVersion: jest.fn(() => '1.0.0')
    }
}));

const preloader = require('@app/assets/js/preloader');

describe('preloader', () => {
    it('should be an object', () => {
        expect(typeof preloader).toBe('object');
    });
});
