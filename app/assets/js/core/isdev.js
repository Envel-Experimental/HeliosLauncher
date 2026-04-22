'use strict'
const getFromEnv = parseInt(process.env.ELECTRON_IS_DEV, 10) === 1
const isEnvSet = 'ELECTRON_IS_DEV' in process.env

const isProd = process.env.NODE_ENV === 'production'
const isDevMode = isEnvSet ? getFromEnv : (process.defaultApp || /node_modules[\\/]electron[\\/]/.test(process.execPath))

// In renderer, we might have HELIOS_DEV_MODE set via preload
const isRenderer = process.type === 'renderer' || typeof window !== 'undefined'
const heliosDev = isRenderer && process.env.HELIOS_DEV_MODE === true

module.exports = isEnvSet ? getFromEnv : (heliosDev ? true : (isProd ? false : isDevMode))
