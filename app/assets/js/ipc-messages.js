// Inter-Process Communication (IPC) constants
// Used to prevent string typos and mismatching channels.

exports.IPC = {
    // Config
    GET_CONFIG: 'get-config',
    SAVE_CONFIG: 'save-config',
    // Auth
    LOGIN: 'auth-login',
    LOGOUT: 'auth-logout',
    VALIDATE_ACCOUNT: 'auth-validate',
    // Distro
    GET_DISTRO: 'get-distro',
    DISTRO_DONE: 'distributionIndexDone',
    // Game
    LAUNCH_GAME: 'game-launch',
    GAME_PROGRESS: 'game-progress',
    GAME_STARTUP_ERROR: 'game-startup-error',
    GAME_ERROR: 'game-error',
    GAME_CLOSE: 'game-close',
    GAME_CONSOLE_LOG: 'game-console-log',
    // Mods
    SCAN_MODS: 'scan-dropin-mods',
    DELETE_MOD: 'delete-dropin-mod',
    TOGGLE_MOD: 'toggle-dropin-mod',
    SCAN_SHADERS: 'scan-shaderpacks',
    SET_SHADER: 'set-shaderpack',
    ADD_MODS: 'add-dropin-mods',
    ADD_SHADERS: 'add-shaderpacks',
    OPEN_FOLDER: 'open-folder',
    // App
    QUIT: 'app-quit',
    RELAUNCH: 'app-relaunch',
    GET_VERSION: 'app-get-version',
    SHOW_MESSAGE_BOX: 'show-message-box',
    OPEN_EXTERNAL: 'open-external',
    SHOW_ITEM_IN_FOLDER: 'show-item-in-folder',
    SYSTEM_WARNINGS: 'system-warnings',
    AUTO_UPDATE: 'autoUpdateNotification',
    AUTO_UPDATE_ACTION: 'autoUpdateAction',
    MSFT_OPCODE: {
        OPEN_LOGIN: 'MSFT_AUTH_OPEN_LOGIN',
        OPEN_LOGOUT: 'MSFT_AUTH_OPEN_LOGOUT',
        REPLY_LOGIN: 'MSFT_AUTH_REPLY_LOGIN',
        REPLY_LOGOUT: 'MSFT_AUTH_REPLY_LOGOUT'
    }
}
