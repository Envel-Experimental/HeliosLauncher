const { contextBridge, ipcRenderer, shell } = require('electron')

contextBridge.exposeInMainWorld('errorApi', {
    restart: () => ipcRenderer.send('app:restart'),
    openUrl: (url) => {
        try {
            const parsed = new URL(url)
            if (['http:', 'https:'].includes(parsed.protocol)) {
                shell.openExternal(url)
            }
        } catch (e) {
            console.error('Invalid URL:', e)
        }
    }
})
