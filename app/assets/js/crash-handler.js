const fs = require('fs-extra');
const path = require('path');

/**
 * Analyzes the game's log content for known crash patterns.
 *
 * @param {string} logContent The content of the latest.log file.
 * @returns {object | null} An object with crash details, or null if no known pattern is found.
 */
exports.analyzeLog = function(logContent) {
    let match;

    // Check for corrupted TOML config files
    const corruptedTomlRegex = /(?:Exception|Failed) loading config file ([\w.-]+\.toml)/;
    match = corruptedTomlRegex.exec(logContent);
    if (match && match[1]) {
        return {
            type: 'corrupted-config',
            file: match[1],
            description: `The configuration file ${match[1]} appears to be corrupted.`
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

    // Check for corrupted .json files
    const corruptedJsonRegex = /com\.google\.gson\.JsonSyntaxException:.*?([a-zA-Z0-9_.-]+\.json)/;
    match = corruptedJsonRegex.exec(logContent);
    if (match && match[1]) {
        return {
            type: 'corrupted-config',
            file: path.basename(match[1]),
            description: `The configuration file ${path.basename(match[1])} appears to be corrupted.`
        };
    }
    
    // Check for corrupted .properties files
    const corruptedPropertiesRegex = /Invalid config file (.+)\.properties/;
    match = corruptedPropertiesRegex.exec(logContent);
    if (match && match[1]) {
        return {
            type: 'corrupted-config',
            file: match[1] + '.properties',
            description: `The configuration file ${match[1]}.properties appears to be corrupted.`
        };
    }

    // Check for missing version json file (ENOENT)
    const missingVersionJsonRegex = /ENOENT: no such file or directory, open '.*[\\/]versions[\\/](.+)[\\/]\1\.json'/;
    match = missingVersionJsonRegex.exec(logContent);
    if (match && match[1]) {
        return {
            type: 'missing-version-file',
            file: match[1] + '.json',
            description: "Файл версии поврежден. Нажми 'Исправить' для восстановления."
        };
    }

    return null;
}
