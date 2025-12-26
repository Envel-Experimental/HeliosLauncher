const fs = require('fs-extra')
const { retry } = require('./util')
const { LoggerUtil } = require('@envel/helios-core')

const logger = LoggerUtil.getLogger('FileUtils')

/**
 * Checks if an error is a file system lock error.
 * @param {Error} err The error to check.
 * @returns {boolean} True if retryable.
 */
function isLockError(err) {
    const codes = ['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EEXIST', 'unlink']
    return codes.includes(err.code) || (err.message && (err.message.includes('locked') || err.message.includes('busy')))
}

exports.safeEnsureDir = async function(dirPath) {
    return retry(
        async () => {
            await fs.ensureDir(dirPath)
        },
        5,
        500, // Initial delay, exponentially increases by factor of 2 (500, 1000, 2000, 4000)
        isLockError
    ).catch(err => {
        logger.error(`Failed to ensure directory ${dirPath} after retries.`, err)
        throw new Error(`Не удалось создать или получить доступ к папке: ${dirPath}. Возможно, она заблокирована антивирусом или другим процессом.`)
    })
}

exports.safeWriteFile = async function(filePath, data, options) {
    return retry(
        async () => {
            await fs.writeFile(filePath, data, options)
        },
        5,
        500,
        isLockError
    ).catch(err => {
        logger.error(`Failed to write file ${filePath} after retries.`, err)
        throw new Error(`Не удалось записать файл: ${filePath}. Пожалуйста, закройте игру и попробуйте снова.`)
    })
}

exports.safeReadFile = async function(filePath, options) {
    return retry(
        async () => {
            return await fs.readFile(filePath, options)
        },
        5,
        500,
        isLockError
    ).catch(err => {
        logger.error(`Failed to read file ${filePath} after retries.`, err)
        throw new Error(`Не удалось прочитать файл: ${filePath}.`)
    })
}

exports.safeUnlink = async function(filePath) {
    return retry(
        async () => {
            if (await fs.pathExists(filePath)) {
                await fs.unlink(filePath)
            }
        },
        5,
        500,
        isLockError
    ).catch(err => {
        logger.warn(`Failed to delete file ${filePath} after retries.`, err)
        // We usually don't throw here for cleanup, just warn
    })
}

exports.safeRemove = async function(dirPath) {
    return retry(
        async () => {
             await fs.remove(dirPath)
        },
        5,
        500,
        isLockError
    ).catch(err => {
        logger.warn(`Failed to remove directory ${dirPath} after retries.`, err)
    })
}
