// Manual mock for app/assets/js/processbuilder/modules/logging.js
const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(), // Add other methods if used
}

module.exports = logger
