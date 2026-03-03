const { contextBridge, ipcRenderer, shell } = require('electron')

contextBridge.exposeInMainWorld('errorApi', {
    restart: () => {
        ipcRenderer.send('app:restart')
    },
    openUrl: (url) => {
        ipcRenderer.send('app:open-url', url)
    }
})


