const fs = require('fs-extra');
const path = require('path');

/**
 * Analyzes the game's log content for known crash patterns.
 *
 * @param {string} logContent The content of the latest.log file.
 * @returns {object | null} An object with crash details, or null if no known pattern is found.
 */
exports.analyzeLog = function(logContent) {
    // Check for corrupted TOML config files
    const corruptedTomlRegex = /Exception loading config file (.+)\.toml/;
    let match = corruptedTomlRegex.exec(logContent);
    if (match && match[1]) {
        return {
            type: 'corrupted-config',
            file: match[1] + '.toml',
            description: `The configuration file ${match[1]}.toml appears to be corrupted.`
        };
    }

    // Check for corrupted .cfg files
    const corruptedCfgRegex = /Configuration file (.+)\.cfg is corrupt/;
    match = corruptedCfgRegex.exec(logContent);
    if (match && match[1]) {
        return {
            type: 'corrupted-config',
            file: match[1] + '.cfg',
            description: `The configuration file ${match[1]}.cfg appears to be corrupted.`
        };
    }

    return null;
}
