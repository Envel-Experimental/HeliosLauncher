const { LoggerUtil } = require('helios-core')

// Centralized logger for the ProcessBuilder context
const logger = LoggerUtil.getLogger('ProcessBuilder')

// You could also export specific logging functions if you want more control:
// const info = (message, ...args) => logger.info(message, ...args);
// const warn = (message, ...args) => logger.warn(message, ...args);
// const error = (message, ...args) => logger.error(message, ...args);
// module.exports = { info, warn, error, logger };

module.exports = logger
