'use strict'
const getFromEnv = parseInt(process.env.ELECTRON_IS_DEV, 10) === 1
const isEnvSet = 'ELECTRON_IS_DEV' in process.env

const isProd = process.env.NODE_ENV === 'production'
const isDevMode = isEnvSet ? getFromEnv : (process.defaultApp || /node_modules[\\/]electron[\\/]/.test(process.execPath))

module.exports = isEnvSet ? getFromEnv : (isProd ? false : isDevMode)
