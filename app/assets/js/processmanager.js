const child_process = require('child_process')
const { LoggerUtil } = require('@envel/helios-core')
const FileUtils = require('./fileutils')
const path = require('path')

const logger = LoggerUtil.getLogger('ProcessManager')

/**
 * Scans for Java processes that might be locking files in the game directory.
 * @param {string} gameDir The directory to check against.
 * @returns {Promise<void>}
 */
exports.cleanupJavaProcesses = async function(gameDir) {
    logger.info(`Scanning for zombie Java processes affecting: ${gameDir}`)

    try {
        const processes = await getJavaProcesses()
        const zombieProcs = processes.filter(p => {
            // Check if command line contains the game directory
            // We want to be careful not to kill unrelated Java processes
            return p.cmd.includes(gameDir) || (p.cmd.includes('LaunchWrapper') && p.cmd.includes('minecraft'))
        })

        if (zombieProcs.length > 0) {
            logger.info(`Found ${zombieProcs.length} potential zombie processes.`)
            for (const proc of zombieProcs) {
                logger.info(`Killing zombie process PID: ${proc.pid}, CMD: ${proc.cmd}`)
                try {
                    process.kill(proc.pid, 'SIGKILL')
                } catch (e) {
                    logger.warn(`Failed to kill process ${proc.pid}`, e)
                }
            }
            // Wait a moment for OS to release locks
            await new Promise(resolve => setTimeout(resolve, 1000))
        } else {
            logger.info('No zombie processes found.')
        }

    } catch (err) {
        logger.warn('Failed to scan/kill zombie processes.', err)
    }
}

function getJavaProcesses() {
    return new Promise((resolve, reject) => {
        const platform = process.platform
        const cmd = platform === 'win32'
            ? 'wmic process where "name=\'javaw.exe\' or name=\'java.exe\'" get ProcessId,CommandLine /format:csv'
            : 'ps -eo pid,command | grep java'

        child_process.exec(cmd, (err, stdout, stderr) => {
            if (err) {
                // If no processes found, grep returns 1, wmic might return empty
                if (err.code === 1) return resolve([])
                return resolve([])
            }

            const lines = stdout.trim().split('\n')
            const processes = []

            if (platform === 'win32') {
                // CSV format: Node,CommandLine,ProcessId
                // Skip headers (usually 2 lines in wmic output sometimes blank lines)
                for (const line of lines) {
                    const parts = line.split(',') // This is naive for CSV but wmic output is simple usually
                    if (parts.length >= 3) {
                        const pid = parseInt(parts[parts.length - 1])
                        // Reconstruct cmd in case it had commas
                        const commandLine = parts.slice(1, parts.length - 1).join(',')
                        if (!isNaN(pid)) {
                            processes.push({ pid, cmd: commandLine })
                        }
                    }
                }
            } else {
                // Unix format: PID COMMAND...
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/)
                    const pid = parseInt(parts[0])
                    const commandLine = parts.slice(1).join(' ')
                    if (!isNaN(pid) && !line.includes('grep')) {
                        processes.push({ pid, cmd: commandLine })
                    }
                }
            }
            resolve(processes)
        })
    })
}
