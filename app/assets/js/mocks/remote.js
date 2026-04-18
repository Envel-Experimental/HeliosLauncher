// Mock for '@electron/remote' in the Renderer
const { HeliosAPI } = window

module.exports = {
    getCurrentWindow: () => ({
        close: HeliosAPI.window.close,
        minimize: HeliosAPI.window.minimize,
        maximize: HeliosAPI.window.maximize,
        unmaximize: HeliosAPI.window.maximize,
        isMaximized: () => false, // Placeholder
        setProgressBar: HeliosAPI.window.setProgressBar,
        toggleDevTools: HeliosAPI.window.toggleDevTools,
        on: () => { }, // Mock events
        hide: () => { }
    }),
    app: {
        getVersion: () => '2.4.0-beta',
        getName: () => 'FLauncher'
    },
    getCurrentWebContents: () => ({
        on: () => { },
        send: () => { }
    }),
    dialog: {
        showOpenDialog: () => HeliosAPI.ipc.invoke('dialog:open'),
        showMessageBox: () => HeliosAPI.ipc.invoke('dialog:message')
    }
}
