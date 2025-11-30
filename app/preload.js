/* eslint-disable no-unused-vars */
const { contextBridge, ipcRenderer, shell, webFrame } = require('electron')
const path = require('path')
const { IPC } = require('./assets/js/ipcconstants')
const ConfigManager = require('./assets/js/configmanager')
const DistroAPI = require('./assets/js/distromanager').DistroAPI
const AuthManager = require('./assets/js/authmanager') // Added
const LangLoader = require('./assets/js/langloader')
const { LoggerUtil } = require('@envel/helios-core')
const crypto = require('crypto')

const logger = LoggerUtil.getLogger('Preload')

// Initialize ConfigManager via IPC
const dataPath = ipcRenderer.sendSync(IPC.GET_DATA_PATH)
if (dataPath) {
    ConfigManager.setLauncherDirectory(dataPath)
    ConfigManager.load() // Load synchronous config
} else {
    logger.error('Failed to get data path from main process!')
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
    // Config API
    config: {
        get: (key) => {
            // Not implemented directly, use specific getters or exposed ConfigManager wrapper
        },
        save: async () => {
            await ConfigManager.save()
            ipcRenderer.send(IPC.SAVE_CONFIG)
        },
        getSelectedServer: ConfigManager.getSelectedServer,
        setSelectedServer: ConfigManager.setSelectedServer,
        getSelectedAccount: ConfigManager.getSelectedAccount,
        setSelectedAccount: ConfigManager.setSelectedAccount,
        getAuthAccounts: ConfigManager.getAuthAccounts,
        addMojangAuthAccount: ConfigManager.addMojangAuthAccount,
        removeAuthAccount: ConfigManager.removeAuthAccount,
        addMicrosoftAuthAccount: ConfigManager.addMicrosoftAuthAccount,
        updateMicrosoftAuthAccount: ConfigManager.updateMicrosoftAuthAccount,
        updateMojangAuthAccount: ConfigManager.updateMojangAuthAccount,

        getModConfiguration: ConfigManager.getModConfiguration,
        setModConfiguration: ConfigManager.setModConfiguration,
        setModConfigurations: ConfigManager.setModConfigurations,

        getJavaExecutable: ConfigManager.getJavaExecutable,
        setJavaExecutable: ConfigManager.setJavaExecutable,
        getMinRAM: ConfigManager.getMinRAM,
        setMinRAM: ConfigManager.setMinRAM,
        getMaxRAM: ConfigManager.getMaxRAM,
        setMaxRAM: ConfigManager.setMaxRAM,
        getJVMOptions: ConfigManager.getJVMOptions,
        setJVMOptions: ConfigManager.setJVMOptions,
        ensureJavaConfig: ConfigManager.ensureJavaConfig,

        getGameWidth: ConfigManager.getGameWidth,
        setGameWidth: ConfigManager.setGameWidth,
        validateGameWidth: ConfigManager.validateGameWidth,
        getGameHeight: ConfigManager.getGameHeight,
        setGameHeight: ConfigManager.setGameHeight,
        validateGameHeight: ConfigManager.validateGameHeight,
        getFullscreen: ConfigManager.getFullscreen,
        setFullscreen: ConfigManager.setFullscreen,
        getAutoConnect: ConfigManager.getAutoConnect,
        setAutoConnect: ConfigManager.setAutoConnect,
        getLaunchDetached: ConfigManager.getLaunchDetached,
        setLaunchDetached: ConfigManager.setLaunchDetached,

        getAllowPrerelease: ConfigManager.getAllowPrerelease,
        setAllowPrerelease: ConfigManager.setAllowPrerelease,

        getInstanceDirectory: ConfigManager.getInstanceDirectory,
        getCommonDirectory: ConfigManager.getCommonDirectory,
        getDataDirectory: ConfigManager.getDataDirectory,

        // RAM helpers
        getAbsoluteMinRAM: ConfigManager.getAbsoluteMinRAM,
        getAbsoluteMaxRAM: ConfigManager.getAbsoluteMaxRAM
    },

    // Distribution API
    distro: {
        getDistribution: async () => {
            return await DistroAPI.getDistribution()
        },
        refreshDistributionOrFallback: async () => {
            return await DistroAPI.refreshDistributionOrFallback()
        },
        isDevMode: () => DistroAPI.isDevMode(),
        toggleDevMode: (v) => DistroAPI.toggleDevMode(v)
    },

    // Game Launcher API
    game: {
        launch: (server, user) => ipcRenderer.send(IPC.LAUNCH_GAME, server, user),
        onProgress: (callback) => ipcRenderer.on(IPC.GAME_PROGRESS, (_, ...args) => callback(...args)),
        onStartupError: (callback) => ipcRenderer.on(IPC.GAME_STARTUP_ERROR, (_, ...args) => callback(...args)),
        onError: (callback) => ipcRenderer.on(IPC.GAME_ERROR, (_, ...args) => callback(...args)),
        onClose: (callback) => ipcRenderer.on(IPC.GAME_CLOSE, (_, ...args) => callback(...args)),
        onConsoleLog: (callback) => ipcRenderer.on(IPC.GAME_CONSOLE_LOG, (_, ...args) => callback(...args))
    },

    // Mods API
    mods: {
        scanDropinMods: (dir, ver) => ipcRenderer.invoke(IPC.SCAN_MODS, dir, ver),
        deleteDropinMod: (dir, name) => ipcRenderer.invoke(IPC.DELETE_MOD, dir, name),
        toggleDropinMod: (dir, name, enable) => ipcRenderer.invoke(IPC.TOGGLE_MOD, dir, name, enable),
        scanShaderpacks: (dir) => ipcRenderer.invoke(IPC.SCAN_SHADERS, dir),
        setShaderpack: (dir, pack) => ipcRenderer.invoke(IPC.SET_SHADER, dir, pack),
        addDropinMods: (files, dir) => ipcRenderer.invoke(IPC.ADD_MODS, files, dir),
        addShaderpacks: (files, dir) => ipcRenderer.invoke(IPC.ADD_SHADERS, files, dir),
        openFolder: (dir) => ipcRenderer.send(IPC.OPEN_FOLDER, dir)
    },

    // App API
    app: {
        quit: () => ipcRenderer.send(IPC.QUIT),
        relaunch: () => ipcRenderer.send(IPC.RELAUNCH),
        getVersion: () => ipcRenderer.sendSync(IPC.GET_VERSION),
        showMessageBox: (options) => ipcRenderer.invoke(IPC.SHOW_MESSAGE_BOX, options),
        openExternal: (url) => ipcRenderer.send(IPC.OPEN_EXTERNAL, url),
        showItemInFolder: (path) => ipcRenderer.send(IPC.SHOW_ITEM_IN_FOLDER, path),
        platform: process.platform
    },

    // Auth API wrapper (invokes main process or uses local if possible)
    auth: {
        openLogin: (s, c) => ipcRenderer.send(IPC.MSFT_OPCODE.OPEN_LOGIN, s, c),
        openLogout: (u, l) => ipcRenderer.send(IPC.MSFT_OPCODE.OPEN_LOGOUT, u, l),
        onLoginReply: (cb) => ipcRenderer.on(IPC.MSFT_OPCODE.REPLY_LOGIN, (_, ...args) => cb(...args)),
        onLogoutReply: (cb) => ipcRenderer.on(IPC.MSFT_OPCODE.REPLY_LOGOUT, (_, ...args) => cb(...args)),
        validateSelected: async () => await AuthManager.validateSelected(),
        addMojangAccount: async (u, p) => await AuthManager.addMojangAccount(u, p),
        removeMojangAccount: async (u) => await AuthManager.removeMojangAccount(u),
        addMicrosoftAccount: async (code) => await AuthManager.addMicrosoftAccount(code),
        removeMicrosoftAccount: async (u) => await AuthManager.removeMicrosoftAccount(u),

        // Expose simple crypto for offline auth
        generateOfflineUUID: (username) => {
            const hash = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest('hex')
            return `${hash.substr(0, 8)}-${hash.substr(8, 4)}-${hash.substr(12, 4)}-${hash.substr(16, 4)}-${hash.substr(20)}`
        }
    },

    // Events
    on: (channel, callback) => {
        const validChannels = [
            IPC.DISTRO_DONE,
            IPC.SYSTEM_WARNINGS,
            IPC.AUTO_UPDATE,
            'power-resume'
        ]
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => callback(...args))
        }
    },

    // Remove listeners
    removeAllListeners: (channel) => {
        ipcRenderer.removeAllListeners(channel)
    },

    // Utils
    isDev: require('./assets/js/isdev'),

    // Lang
    lang: {
        queryJS: (key, args) => LangLoader.queryJS(key, args)
    },

    // Logger
    logger: {
        info: (msg) => logger.info(msg),
        warn: (msg) => logger.warn(msg),
        error: (msg) => logger.error(msg),
        debug: (msg) => logger.debug(msg)
    },

    // WebFrame
    webFrame: {
        setZoomLevel: (level) => webFrame.setZoomLevel(level),
        setVisualZoomLevelLimits: (min, max) => webFrame.setVisualZoomLevelLimits(min, max)
    }
})
