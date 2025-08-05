const { LoggerUtil } = require('@envel/helios-core');

const logger = LoggerUtil.getLogger('Benchmark');

const benchmarks = {};

/**
 * Starts a new benchmark timer.
 *
 * @param {string} name The name of the benchmark.
 */
exports.start = function(name) {
    benchmarks[name] = {
        start: process.hrtime.bigint()
    };
    logger.info(`Benchmark '${name}' started.`);
}

/**
 * Ends a benchmark timer and logs the result.
 *
 * @param {string} name The name of the benchmark.
 */
exports.end = function(name) {
    if (benchmarks[name] && benchmarks[name].start) {
        const end = process.hrtime.bigint();
        const duration = (end - benchmarks[name].start) / 1000000n; // Convert nanoseconds to milliseconds
        logger.info(`Benchmark '${name}' ended. Duration: ${duration}ms`);
        delete benchmarks[name];
    } else {
        logger.warn(`Benchmark '${name}' was not started.`);
    }
}
