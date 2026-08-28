/**
 * appPreload.js — injected into every app BrowserWindow (localhost:4001-4004).
 *
 * Bridges window.electronAPI so app UIs that detect Electron (e.g. State Logic
 * Builder) get native file dialogs, direct-overwrite saves, and update status —
 * identical behaviour to their standalone Electron builds.
 *
 * IPC handlers for 'app-save-file', 'app-save-file-direct', 'app-open-file'
 * are registered in main.js and delegate to Electron's dialog module.
 */
const { contextBridge, ipcRenderer } = require('electron');

// ── Cross-app navigation, for apps that link to each other ─────────────────
//
// Exposed 2026-08-28. Without it an embedded app's only way to reach another
// app was a target="_blank" link, and setWindowOpenHandler (main.js) answers
// those with shell.openExternal — which throws the user OUT of SDC Tools into
// their default browser, at a standalone copy of an app that is very likely
// already open as a shell window, and without the shell's session.
//
// That is exactly what Reports' "Project Schedule" job-menu item did.
//
// Only an appId and a same-origin PATH cross the bridge. The shell owns every
// app's origin (processManager's port registry), so a renderer cannot aim a
// shell window at an arbitrary URL.
contextBridge.exposeInMainWorld('sdcShell', {
  /**
   * Open (or focus, and navigate) another SDC Tools app.
   * @param {string} appId   e.g. 'scheduler'
   * @param {string} [path]  same-origin path+query, e.g. '/?job=1127&view=schedule'
   */
  openApp: (appId, path) => ipcRenderer.invoke('open-app', appId, path),
});

contextBridge.exposeInMainWorld('electronAPI', {
  // ── File operations (native OS dialogs) ───────────────────────────────────

  /** Show Save dialog, write file, return { success, filePath } */
  saveFile: (fileName, content) =>
    ipcRenderer.invoke('app-save-file', { fileName, content }),

  /** Overwrite an already-known path silently, return { success } */
  saveFileDirect: (filePath, content) =>
    ipcRenderer.invoke('app-save-file-direct', { filePath, content }),

  /** Show Open dialog, return { success, filePath, content } */
  openFile: () =>
    ipcRenderer.invoke('app-open-file'),

  // ── Auto-update (forwarded from shell updater) ────────────────────────────
  // The shell manages updates; we surface the current status so the app's
  // sidebar "Up to date!" / update badge keeps working.

  checkForUpdates: () =>
    ipcRenderer.invoke('app-check-for-updates'),

  onUpdateStatus: (callback) => {
    const handler = (_, msg) => callback(msg);
    ipcRenderer.on('app-update-status', handler);
    return () => ipcRenderer.removeListener('app-update-status', handler);
  },

  // ── Auth (shell SSO user info) ────────────────────────────────────────────
  authGetStatus: () => ipcRenderer.invoke('auth-get-status'),

  // ── Notifications ─────────────────────────────────────────────────────────
  showNotification:       (opts) => ipcRenderer.invoke('show-notification', opts),
  getNotifications:       ()     => ipcRenderer.invoke('get-notifications'),
  dismissNotification:    (id)   => ipcRenderer.invoke('dismiss-notification', id),
  clearNotifications:     ()     => ipcRenderer.invoke('clear-notifications'),
  markNotificationsRead:  ()     => ipcRenderer.invoke('mark-notifications-read'),
  onNotificationsUpdated: (cb)   => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('notifications-updated', handler);
    return () => ipcRenderer.removeListener('notifications-updated', handler);
  },
});
