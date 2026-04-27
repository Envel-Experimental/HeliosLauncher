const os = require('os')
const crypto = require('crypto')

/**
 * Generate a hardware ID based on system information.
 * This ID should be persistent across application restarts and config resets.
 */
function getHWID() {
    try {
        const interfaces = os.networkInterfaces()
        const macs = []
        
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (!iface.internal && iface.mac !== '00:00:00:00:00:00') {
                    macs.push(iface.mac)
                }
            }
        }
        
        // Sort to ensure consistency
        macs.sort()
        
        const platform = process.platform
        const arch = process.arch
        const cpuModel = os.cpus()[0]?.model || 'unknown'
        
        const rawString = [platform, arch, cpuModel, ...macs].join('|')
        
        return crypto.createHash('sha256').update(rawString).digest('hex')
    } catch (e) {
        // Fallback to a random ID if something fails, but this shouldn't happen
        return 'fallback_' + Math.random().toString(36).substring(2, 15)
    }
}

module.exports = { getHWID }
