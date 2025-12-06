
const { LoggerUtil } = require('./common');
const logger = LoggerUtil.getLogger('Network');

class RestResponseStatus {
    static SUCCESS = 'SUCCESS';
    static ERROR = 'ERROR';
}

/**
 * Custom Error classes to mimic got errors
 */
class RequestError extends Error {
    constructor(message, code, originalError) {
        super(message);
        this.name = 'RequestError';
        this.code = code;
        this.originalError = originalError;
    }
}

class HTTPError extends RequestError {
    constructor(response) {
        super(`Response code ${response.status} (${response.statusText})`, 'ERR_NON_2XX_3XX_RESPONSE');
        this.name = 'HTTPError';
        this.response = response;
    }
}

class TimeoutError extends RequestError {
    constructor(message) {
        super(message || 'Request timed out', 'ETIMEDOUT');
        this.name = 'TimeoutError';
    }
}

class ParseError extends RequestError {
    constructor(message, originalError) {
        super(message, 'EPARSE', originalError);
        this.name = 'ParseError';
    }
}

/**
 * Fetch wrapper to replace got.get
 * @param {string} url
 * @param {Object} options
 */
async function fetchJson(url, options = {}) {
    const { timeout = {}, responseType = 'json', ...fetchOptions } = options;

    // Default timeout logic
    // 'got' has connect/socket/request timeouts. We'll implement a simple global request timeout for now.
    const timeoutMs = timeout.connect || timeout.request || 15000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...fetchOptions,
            signal: controller.signal
        });

        if (!response.ok) {
            // Need to read body for error logging potentially, but be careful with streams
            // For now, attach response object
            throw new HTTPError(response);
        }

        if (responseType === 'json') {
            try {
                return {
                    body: await response.json(),
                    statusCode: response.status,
                    headers: response.headers
                };
            } catch (err) {
                throw new ParseError('Failed to parse JSON body', err);
            }
        } else {
            return {
                body: await response.text(),
                statusCode: response.status,
                headers: response.headers
            };
        }

    } catch (err) {
        if (err.name === 'AbortError') {
            throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
        }
        if (err instanceof RequestError) {
            throw err;
        }
        // Network errors (e.g. ECONNREFUSED) usually come as TypeErrors or similar in fetch
        throw new RequestError(err.message, err.cause ? err.cause.code : 'UNKNOWN', err);
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Handle errors for RestResponse
 */
function handleFetchError(operation, error, loggerInstance, dataProvider) {
    const logger = loggerInstance || LoggerUtil.getLogger('RestResponse');

    const response = {
        data: dataProvider ? dataProvider() : null,
        responseStatus: RestResponseStatus.ERROR,
        error
    };

    if (error instanceof HTTPError) {
        logger.error(`Error during ${operation} request (HTTP Response ${error.response.status})`, error);
        logger.debug('Response Details:');
        logger.debug(`URL: ${error.response.url}`);
        // Cannot easily log body/headers here without consuming them if not already consumed
    } else if (error instanceof TimeoutError) {
        logger.error(`${operation} request timed out.`);
    } else if (error instanceof ParseError) {
        logger.error(`${operation} request received unexpected body (Parse Error).`);
    } else {
        logger.error(`Error during ${operation} request.`, error);
    }

    return response;
}

module.exports = {
    fetchJson,
    RestResponseStatus,
    handleFetchError,
    RequestError,
    HTTPError,
    TimeoutError,
    ParseError
};
