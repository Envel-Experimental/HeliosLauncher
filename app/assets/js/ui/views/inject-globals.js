/**
 * Global injection script for esbuild.
 * Refactored for new project structure: app/assets/js/core/
 */

const { LoggerUtil } = require('@core/util/LoggerUtil')
const Lang = require('@core/langloader')
const ConfigManager = require('@core/configmanager')
const AuthManager = require('@core/authmanager')
const { isDisplayableError } = require('@core/common/RestResponse')

window.LoggerUtil = LoggerUtil
window.Lang = Lang
window.ConfigManager = ConfigManager
window.AuthManager = AuthManager
window.isDisplayableError = isDisplayableError
window.global = window

if (typeof window.HeliosAPI !== 'undefined') {
    window.ipcRenderer = window.HeliosAPI.ipc
    window.shell = window.HeliosAPI.shell
    window.currentWindow = window.HeliosAPI.window
}

// Global Distribution Types Injection
const { 
    HeliosDistribution, 
    HeliosServer, 
    HeliosModule, 
    Type, 
    Platform, 
    JdkDistribution 
} = require('@core/common/DistributionClasses')

window.HeliosDistribution = HeliosDistribution
window.HeliosServer = HeliosServer
window.HeliosModule = HeliosModule
window.Type = Type
window.Platform = Platform
window.JdkDistribution = JdkDistribution

// Global Path Polyfill Injection
const path = require('path')
window.path = path

// Global Buffer Polyfill
const { Buffer } = require('buffer')
window.Buffer = Buffer

// Advanced Process Polyfill to prevent crashes from missing Node.js methods
const safeGet = (path, fallback) => {
    try {
        const parts = path.split('.')
        let res = window
        for (const part of parts) {
            if (res[part] === undefined) return fallback
            res = res[part]
        }
        return typeof res === 'function' ? res() : res
    } catch (e) {
        return fallback
    }
}

const baseProcess = {
    platform: safeGet('HeliosAPI.system.getPlatform', 'win32'),
    arch: safeGet('HeliosAPI.system.getArch', 'x64'),
    versions: safeGet('HeliosAPI.system.getVersions', {}),
    version: safeGet('HeliosAPI.system.getVersion', '1.0.0'),
    cwd: () => safeGet('HeliosAPI.system.cwd', 'C:\\'),
    env: safeGet('HeliosAPI.system.getEnv', {}),
    type: 'renderer',
    browser: true,
    argv: [],
    execPath: 'C:\\',
    nextTick: (fn, ...args) => setTimeout(() => fn(...args), 0),
    emitWarning: (msg) => console.warn('[Process Warning]', msg)
}

const processHandler = {
    get: (target, prop) => {
        if (prop in target) return target[prop]
        
        // Data properties that should be falsy if missing
        if (typeof prop === 'string' && (prop === 'defaultApp' || prop === 'electron')) {
            return undefined
        }

        // Return a no-op function for missing methods to avoid "is not a function" errors
        return (...args) => {
            console.debug(`[Process Polyfill] Stubbed method called: process.${String(prop)}`)
        }
    }
}

window.process = new Proxy(baseProcess, processHandler)

console.log('HeliosLauncher: Global Dependencies Injected (New Structure)')
