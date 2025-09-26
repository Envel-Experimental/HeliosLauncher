const os = require('os')
const checkDiskSpace = require('check-disk-space').default
const ConfigManager = require('./configmanager')

// Configurable thresholds
const TOTAL_RAM_THRESHOLD_GB = 6
const FREE_RAM_THRESHOLD_GB = 1.0
const FREE_DISK_THRESHOLD_GB = 10

// Convert GB to Bytes for comparison
const BYTES_PER_GB = 1024 * 1024 * 1024

/**
 * Performs system requirement checks for RAM and disk space.
 *
 * @returns {Promise<Array<string>>} A promise that resolves to an array of warning keys.
 */
exports.performChecks = async function() {
    const warnings = []

    // 1. Total RAM Check (one-time)
    if (!ConfigManager.getTotalRAMWarningShown()) {
        const totalRam = os.totalmem() / BYTES_PER_GB
        if (totalRam < TOTAL_RAM_THRESHOLD_GB) {
            warnings.push('lowTotalRAM')
            ConfigManager.setTotalRAMWarningShown(true)
            ConfigManager.save()
        }
    }

    // 2. Free RAM Check (every launch)
    const freeRam = os.freemem() / BYTES_PER_GB
    if (freeRam < FREE_RAM_THRESHOLD_GB) {
        warnings.push('lowFreeRAM')
    }

    // 3. Free Disk Space Check (every launch)
    try {
        const diskSpace = await checkDiskSpace(os.platform() === 'win32' ? 'C:' : '/')
        const freeDisk = diskSpace.free / BYTES_PER_GB
        if (freeDisk < FREE_DISK_THRESHOLD_GB) {
            warnings.push('lowDiskSpace')
        }
    } catch (err) {
        console.error('Error checking disk space:', err)
    }

    return warnings
}