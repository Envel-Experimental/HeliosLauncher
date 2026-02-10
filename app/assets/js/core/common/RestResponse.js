const RestResponseStatus = {
    SUCCESS: 'SUCCESS',
    ERROR: 'ERROR'
}

function isDisplayableError(it) {
    return typeof it == 'object'
        && it != null
        && Object.prototype.hasOwnProperty.call(it, 'title')
        && Object.prototype.hasOwnProperty.call(it, 'desc');
}

async function handleFetchError(operation, error, logger, dataProvider) {
    // Serialize Error object to ensure message/stack survive JSON.stringify (IPC)
    let serializedError = error;
    if (error instanceof Error) {
        serializedError = {
            message: error.message,
            stack: error.stack,
            code: error.code,
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
