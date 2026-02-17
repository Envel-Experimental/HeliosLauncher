const fs = require('fs/promises')
const path = require('path')

/**
 * Asynchronously retries a function with a specified number of attempts and delay.
 */
exports.retry = async function (func, retries = 3, delay = 1000, isRetryable = () => true) {
    for (let i = 0; i < retries; i++) {
        try {
            return await func()
        } catch (err) {
            if (isRetryable(err) && i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)))
            } else {
                throw err
            }
        }
    }
}

/**
 * Ensures that the directory exists. If the directory structure does not exist, it is created.
 */
exports.ensureDir = async function (dirPath) {
    await fs.mkdir(dirPath, { recursive: true })
}

/**
 * Moves a file or directory. Handles cross-device moves by falling back to copy/delete.
 * Creates destination directory if it doesn't exist.
 */
exports.move = async function (src, dest) {
    // FIX: Сначала создаем папку, куда перемещаем, иначе fs.rename упадет
    await exports.ensureDir(path.dirname(dest))

    try {
        await fs.rename(src, dest)
    } catch (err) {
        if (err.code === 'EXDEV') {
            await fs.cp(src, dest, { recursive: true, force: true })
            await fs.rm(src, { recursive: true, force: true })
        } else {
            throw err
        }
    }
}

/**
 * Atomically writes an object to a JSON file.
 * Creates directory if it doesn't exist.
 */
exports.safeWriteJson = async function (file, data) {
    const tempFile = file + '.tmp.' + Date.now()

    // FIX: Убедимся, что папка для файла существует
    await exports.ensureDir(path.dirname(file))

    try {
        await fs.writeFile(tempFile, JSON.stringify(data, null, 4), 'utf-8')
        // Используем наш move, так как он уже умеет обрабатывать ошибки
        // Но так как мы в одной папке, rename сработает почти всегда
        await fs.rename(tempFile, file)
    } catch (err) {
        // Cleanup temp file if it exists
        try {
            await fs.rm(tempFile, { force: true })
        } catch (e) {
            // Ignore
        }
        throw err
    }
}

/**
 * Safely reads a JSON file. Returns null if the file does not exist.
 * Throws if the file is corrupted (invalid JSON).
 */
exports.safeReadJson = async function (file) {
    try {
        const data = await fs.readFile(file, 'utf-8')
        return JSON.parse(data)
    } catch (err) {
        // ENOENT = файл не найден, это нормально для первого запуска
        if (err.code === 'ENOENT') {
            return null
        }
        throw err
    }
}

/**
 * deeply merges two objects.
 * @param {object} obj
 * @param {object} defaults
 * @returns {object}
 */
exports.deepMerge = function (obj, defaults) {
    if (!defaults) return obj
    if (!obj) return defaults

    if (typeof obj !== 'object' || typeof defaults !== 'object' || Array.isArray(obj) || Array.isArray(defaults)) {
        return obj
    }

    const result = { ...defaults }
    for (const key in obj) {
        const val = obj[key]
        if (val === undefined) continue

        if (Object.prototype.hasOwnProperty.call(result, key) && typeof val === 'object' && val !== null) {
            result[key] = exports.deepMerge(val, result[key])
        } else {
            result[key] = val
        }
    }
    return result
}
