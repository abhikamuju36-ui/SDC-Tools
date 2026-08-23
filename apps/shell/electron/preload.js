const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shellAPI', {
  getStatus:   () => ipcRenderer.invoke('get-status'),
  getLogs:     (appId) => ipcRenderer.invoke('get-logs', appId),
  openApp:     (appId) => ipcRenderer.invoke('open-app', appId),
  retryApp:    (appId) => ipcRenderer.invoke('retry-app', appId),
  stopAll:     () => ipcRenderer.invoke('stop-all'),
  restartAll:  () => ipcRenderer.invoke('restart-all'),
  stopApp:     (appId) => ipcRenderer.invoke('stop-app', appId),
  restartApp:  (appId) => ipcRenderer.invoke('restart-app', appId),
  syncStatus:  () => ipcRenderer.invoke('sync-status'),

  // Returns an unsubscribe function
  onStatusChange: (callback) => {
    const handler = (_, status) => callback(status);
    ipcRenderer.on('status-change', handler);
    return () => ipcRenderer.removeListener('status-change', handler);
  },

  // Per-app log lines streamed in real time
  onAppLog: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('app-log', handler);
    return () => ipcRenderer.removeListener('app-log', handler);
  },

  // ── Auto-updater ──────────────────────────────────────────────────────────
  getAppVersion:    () => ipcRenderer.invoke('get-app-version'),
  getServerHost:    () => ipcRenderer.invoke('get-server-host'),
  updateDownload:   () => ipcRenderer.invoke('update-download'),
  updateInstall:    () => ipcRenderer.invoke('update-install'),

  onUpdateStatus: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },

  // ── System / preferences ──────────────────────────────────────────────────
  getLaunchOnStartup: () => ipcRenderer.invoke('get-launch-on-startup'),
  setLaunchOnStartup: (enable) => ipcRenderer.invoke('set-launch-on-startup', enable),

  // ── Window controls ───────────────────────────────────────────────────────
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose:    () => ipcRenderer.invoke('window-close'),

  // ── Manual update trigger ─────────────────────────────────────────────────
  checkForUpdates: ()     => ipcRenderer.invoke('check-for-updates'),
  triggerUpdate:   (appId) => ipcRenderer.invoke('trigger-update', appId),

  // ── Microsoft SSO auth ────────────────────────────────────────────────────
  authGetStatus: () => ipcRenderer.invoke('auth-get-status'),
  authLogin:     () => ipcRenderer.invoke('auth-login'),
  authLogout:    () => ipcRenderer.invoke('auth-logout'),
  getSdcApps:    () => ipcRenderer.invoke('get-sdc-apps'),

  // ── Notifications ─────────────────────────────────────────────────────────
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
