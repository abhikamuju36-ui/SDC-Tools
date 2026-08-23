// ── SDC Calendar — Electron preload (IPC bridge) ─────────────
// Runs in the renderer context before any page script.
// Exposes a minimal, typed surface via contextBridge — nothing
// else from Node/Electron leaks into the renderer.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('app-version'),
});
