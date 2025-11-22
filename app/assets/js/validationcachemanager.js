const fs = require('fs-extra')
const path = require('path')
const ConfigManager = require('./configmanager')
const { LoggerUtil } = require('@envel/helios-core')

const logger = LoggerUtil.getLogger('ValidationCacheManager')

let validationCache = {}
let cachePath = null

/**
 * Load the validation cache from disk.
 */
exports.load = async function() {
    try {
        if (!cachePath) {
            cachePath = path.join(ConfigManager.getLauncherDirectory(), 'validation-cache.json')
        }
        if (await fs.pathExists(cachePath)) {
            validationCache = await fs.readJson(cachePath)
            logger.info('Validation cache loaded.')
        } else {
            logger.info('No validation cache found.')
            validationCache = {}
        }
    } catch (err) {
        logger.warn('Failed to load validation cache.', err)
        validationCache = {}
    }
}

/**
 * Get the current validation cache object.
 * @returns {Object} The validation cache.
 */
exports.getCache = function() {
    return validationCache
}

/**
 * Update the validation cache with new data and save it to disk.
 * @param {Object} newCacheData The new cache entries to merge.
 */
exports.updateCache = async function(newCacheData) {
    try {
        validationCache = { ...validationCache, ...newCacheData }
        if (!cachePath) {
            cachePath = path.join(ConfigManager.getLauncherDirectory(), 'validation-cache.json')
        }
        await fs.writeJson(cachePath, validationCache)
        logger.info('Validation cache updated.')
    } catch (err) {
        logger.warn('Failed to update validation cache.', err)
    }
}
