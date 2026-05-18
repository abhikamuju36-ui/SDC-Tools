const { contextBridge, ipcRenderer } = require('electron');

// Fetch the resolved API base synchronously so it is available
// the instant React evaluates its module-level constants.
const apiBase = ipcRenderer.sendSync('get-api-base-sync');

contextBridge.exposeInMainWorld('electron', {
    apiBase,                                                            // e.g. "http://192.168.1.10:3001"
    getAppVersion:   () => ipcRenderer.invoke('get-app-version'),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    openPath:        (p)   => ipcRenderer.invoke('open-path', p),
    openExternal:    (url) => ipcRenderer.invoke('open-external', url),
});
