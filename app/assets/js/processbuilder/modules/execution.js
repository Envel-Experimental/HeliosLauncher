const child_process = require('child_process')
const fs = require('fs-extra')
const ConfigManager = require('../../configmanager') // Relative path
const logger = require('./logging') // Use the centralized logger from logging.js
const { handleProcessExitError } = require('./error') // Import error handler

function executeMinecraftProcess(javaExecutable, effectiveJVMArgs, gameDirectory, tempNativePath) {
    logger.info('Launching Minecraft with arguments:')
    logger.info('Java Executable:', javaExecutable)
    logger.info('JVM Arguments:', effectiveJVMArgs)
    logger.info('Game Directory:', gameDirectory)

    const child = child_process.spawn(javaExecutable, effectiveJVMArgs, {
        cwd: gameDirectory,
        detached: ConfigManager.getLaunchDetached(),
    })

    if (ConfigManager.getLaunchDetached()) {
        child.unref()
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (data) => {
        data.trim().split('\n').forEach(x => console.log(`\x1b[32m[Minecraft]\x1b[0m ${x}`))
    })

    child.stderr.on('data', (data) => {
        data.trim().split('\n').forEach(x => console.log(`\x1b[31m[Minecraft]\x1b[0m ${x}`))
    })

    child.on('close', (code, signal) => {
        logger.info('Minecraft process exited with code', code, 'and signal', signal)
        if (code !== 0) {
            handleProcessExitError(code, signal)
        }

        fs.remove(tempNativePath, (err) => {
            if (err) {
                logger.warn('Error while deleting temp native path', tempNativePath, err)
            } else {
                logger.info('Temporary native path deleted successfully:', tempNativePath)
            }
        })
    })

    return child
}

module.exports = {
    executeMinecraftProcess,
}
