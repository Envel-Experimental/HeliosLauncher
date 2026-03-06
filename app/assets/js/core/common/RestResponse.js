// @ts-check

/**
 * @typedef {Object} RestResponse
 * @property {any} data
 * @property {string} responseStatus
 * @property {any} [error]
 */

/**
 * @enum {string}
 */
const RestResponseStatus = {
    SUCCESS: 'SUCCESS',
    ERROR: 'ERROR'
}

/**
 * @param {any} it
 * @returns {boolean}
 */
function isDisplayableError(it) {
    return typeof it == 'object'
        && it != null
        && Object.prototype.hasOwnProperty.call(it, 'title')
        && Object.prototype.hasOwnProperty.call(it, 'desc');
}

/**
 * @param {string} operation 
 * @param {any} error 
 * @param {any} logger 
 * @param {Function} [dataProvider] 
 * @returns {Promise<RestResponse>}
 */
async function handleFetchError(operation, error, logger, dataProvider) {
    // Serialize Error object to ensure message/stack survive JSON.stringify (IPC)
    let serializedError = error;
    if (error instanceof Error) {
        serializedError = {
            message: error.message,
            stack: error.stack,
            code: /** @type {any} */(error).code,
            ...error // Spread any other custom properties
        }
    }

    const response = {
        data: dataProvider ? dataProvider() : null,
        responseStatus: RestResponseStatus.ERROR,
        error: serializedError
    };
    logger.error(`Error during ${operation}`, error);
    return response;
}

module.exports = { RestResponseStatus, isDisplayableError, handleFetchError }
