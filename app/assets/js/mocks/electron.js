// Mock for 'electron' in the Renderer
module.exports = {
    get ipcRenderer() {
        if (!window.HeliosAPI?.ipc) return null
        return {
            ...window.HeliosAPI.ipc,
            sendSync: (channel, ...args) => window.HeliosAPI.ipc.sendSync(channel, ...args)
        }
    },
    get shell() {
        return {
            openExternal: (url) => window.HeliosAPI?.shell?.openExternal(url),
            openPath: (path) => window.HeliosAPI?.shell?.openPath(path),
            trashItem: (path) => window.HeliosAPI?.shell?.trashItem(path)
        }
    },
    get webFrame() {
        return {
            setZoomLevel: () => {},
            setVisualZoomLevelLimits: () => {}
        }
    }
}
