// Utility functions for processbuilder

/**
 * Get the platform specific classpath separator. On windows, this is a semicolon.
 * On Unix, this is a colon.
 *
 * @returns {string} The classpath separator for the current operating system.
 */
function getClasspathSeparator() {
    return process.platform === 'win32' ? ';' : ':'
}

/**
 * Determine if an optional mod is enabled from its configuration value. If the
 * configuration value is null, the required object will be used to
 * determine if it is enabled.
 *
 * A mod is enabled if:
 *   * The configuration is not null and one of the following:
 *     * The configuration is a boolean and true.
 *     * The configuration is an object and its 'value' property is true.
 *   * The configuration is null and one of the following:
 *     * The required object is null.
 *     * The required object's 'def' property is null or true.
 *
 * @param {Object | boolean} modCfg The mod configuration object.
 * @param {Object} required Optional. The required object from the mod's distro declaration.
 * @returns {boolean} True if the mod is enabled, false otherwise.
 */
function isModEnabled(modCfg, required = null){
    return modCfg != null ? ((typeof modCfg === 'boolean' && modCfg) || (typeof modCfg === 'object' && (typeof modCfg.value !== 'undefined' ? modCfg.value : true))) : required != null ? required.def : true
}

module.exports = {
    getClasspathSeparator,
    isModEnabled
}
