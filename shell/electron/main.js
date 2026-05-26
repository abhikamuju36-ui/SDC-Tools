require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, globalShortcut, Notification } = require('electron');
const path = require('path');
const fs   = require('fs');
const processManager = require('./processManager');
const auth           = require('./auth');

// ── Auto-updater (production only) ──────────────────────────────────────────
// Design (mirrors Dan's state_logic_builder approach):
//   • autoDownload = true    — download silently in background, no prompt needed
//   • autoInstallOnAppQuit = false — prevents the double-NSIS-trigger bug
//     (April 2026 incident). Install only fires via explicit quitAndInstall().
//   • Check on launch + every 2 minutes.
let autoUpdater;
if (!process.env.SKIP_AUTO_UPDATE) {
  try {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload         = true;  // silent background download
    autoUpdater.autoInstallOnAppQuit = false; // explicit install only (safety)
    autoUpdater.logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {} };
  } catch (e) {
    console.warn('[updater] electron-updater not available:', e.message);
  }
}

const isDev = !app.isPackaged;

let mainWindow = null;
let tray = null;
const appWindows = new Map();

// ── Notification store ────────────────────────────────────────────────────────
const notificationStore = [];
let notifIdSeq = 0;

function pushNotification({ source, type, title, body, icon }) {
  const n = { id: ++notifIdSeq, source, type, title, body, icon: icon || '🔔', timestamp: Date.now(), read: false };
  notificationStore.unshift(n);
  if (notificationStore.length > 100) notificationStore.pop();
  mainWindow?.webContents.send('notifications-updated', notificationStore);
  _broadcastToAppWindows('notifications-updated', notificationStore);
  // Native OS toast
  if (Notification.isSupported()) {
    const toast = new Notification({ title, body, silent: false });
    toast.show();
  }
  return n;
}

const APP_WINDOW_SIZES = {
  assemblies: { width: 1280, height: 800 },
  readiness:  { width: 1400, height: 900 },
  scheduler:  { width: 1400, height: 900 },
  statelogic: { width: 1440, height: 900 },
  calendar:   { width: 1440, height: 900 },
};

// ── Per-app title-bar icons ───────────────────────────────────────────────────
// Icons live in shell/build/icons/<appId>.png — bundled into the asar via
// electron-builder.yml files[] so the same relative path works in dev and prod.
function _getAppIcon(appId) {
  try {
    const p = path.join(__dirname, '../build/icons', `${appId}.png`);
    return fs.existsSync(p) ? nativeImage.createFromPath(p) : null;
  } catch (_) { return null; }
}

// ── Window bounds persistence ─────────────────────────────────────────────────
const _settingsFile = () => path.join(app.getPath('userData'), 'window-settings.json');
function _loadSettings() {
  try { return JSON.parse(fs.readFileSync(_settingsFile(), 'utf8')); } catch (_) { return {}; }
}
function _saveSettings(data) {
  try { fs.writeFileSync(_settingsFile(), JSON.stringify(data, null, 2)); } catch (_) {}
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 800,
    minHeight: 560,
    title: 'SDC Tools',
    backgroundColor: '#0d0d1a',
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Minimize to tray instead of closing the launcher
  mainWindow.on('close', (e) => {
    if (tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    for (const [, win] of appWindows) {
      if (!win.isDestroyed()) win.close();
    }
    appWindows.clear();
  });
}

function createTray() {
  const trayIconPath = path.join(__dirname, '../build/icon.ico');
  const icon = fs.existsSync(trayIconPath)
    ? nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('SDC Tools');
  _rebuildTrayMenu();
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

function _rebuildTrayMenu() {
  if (!tray) return;
  const status = processManager.getStatus();
  const appItems = Object.values(status).map(app => ({
    label: `${app.emoji || '▶'}  ${app.name}`,
    enabled: app.status === 'running',
    click: () => openAppWindow(app.id),
  }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Launcher', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    ...appItems,
    { type: 'separator' },
    { label: 'Quit', click: () => performQuit() },
  ]));
}

let isQuitting = false;
let pendingUpdate = false;   // true after update is downloaded & user confirmed install
let _lastUpdateStatus = null; // cached for newly-opened app windows

async function performQuit() {
  if (isQuitting) return;
  isQuitting = true;
  try { globalShortcut.unregisterAll(); } catch (_) {}
  await processManager.stopAll();
  tray?.destroy();
  if (pendingUpdate && autoUpdater) {
    autoUpdater.quitAndInstall(false, true);
  } else {
    app.exit(0);
  }
}

function openAppWindow(appId) {
  const status = processManager.getStatus();
  const appInfo = status[appId];

  if (!appInfo) return { error: 'Unknown app' };
  if (appInfo.status !== 'running') return { error: 'Server not ready yet' };

  if (appWindows.has(appId)) {
    const existing = appWindows.get(appId);
    if (!existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return { success: true };
    }
    appWindows.delete(appId);
  }

  // Restore saved bounds, fall back to defaults
  const defaults = APP_WINDOW_SIZES[appId] || { width: 1280, height: 800 };
  const saved    = (_loadSettings()[appId] || {});
  const bounds   = {
    width:  saved.width  || defaults.width,
    height: saved.height || defaults.height,
    ...(saved.x != null ? { x: saved.x } : {}),
    ...(saved.y != null ? { y: saved.y } : {}),
  };

  const icon = _getAppIcon(appId);

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 600,
    title: appInfo.name,
    backgroundColor: '#ffffff',
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'appPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,  // safe — appPreload only uses require('electron'), not Node built-ins
    },
  });

  win.loadURL(appInfo.url);
  win.once('ready-to-show', () => win.show());

  // Push update status so app sidebar shows "Up to date!" immediately
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('app-update-status', _lastUpdateStatus ?? 'up-to-date');
  });

  // Unsaved-changes guard via beforeunload
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes. Leave without saving?',
    });
    if (choice === 0) e.preventDefault();
  });

  // Persist window bounds on close
  win.on('close', () => {
    if (!win.isMinimized() && !win.isMaximized()) {
      const b = win.getBounds();
      const settings = _loadSettings();
      settings[appId] = { x: b.x, y: b.y, width: b.width, height: b.height };
      _saveSettings(settings);
    }
  });

  win.on('closed', () => appWindows.delete(appId));
  win.setMenuBarVisibility(false);

  appWindows.set(appId, win);
  return { success: true };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Broadcast a channel+payload to every open app window. */
function _broadcastToAppWindows(channel, payload) {
  for (const [, win] of appWindows) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

// ── App-window IPC: native file dialogs ──────────────────────────────────────
// These mirror the standalone State Logic Builder's IPC handlers so that
// appPreload.js can expose window.electronAPI identically.

ipcMain.handle('app-save-file', async (e, { fileName, content }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: fileName,
    filters: [
      { name: 'JSON File',  extensions: ['json'] },
      { name: 'L5X File',   extensions: ['L5X', 'l5x'] },
      { name: 'All Files',  extensions: ['*'] },
    ],
  });
  if (canceled || !filePath) return { success: false };
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app-save-file-direct', async (_, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app-open-file', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { success: false };
  try {
    const content = fs.readFileSync(filePaths[0], 'utf8');
    return { success: true, filePath: filePaths[0], content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app-check-for-updates', (e) => {
  // The app sidebar ignores the return value — it waits for an 'app-update-status'
  // event via onUpdateStatus(). Fire it back immediately with the cached status.
  const status = _lastUpdateStatus ?? 'up-to-date';
  e.sender.send('app-update-status', status);
  return status;
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createMainWindow();
  createTray();

  processManager.on('status-change', status => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status-change', status);
    }
    _rebuildTrayMenu(); // keep quick-open items in sync with running state
  });

  processManager.on('log', ({ id, line }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app-log', { id, line });
    }
  });

  processManager.startAll();

  // Start notification polling — first run after 15 s (let apps boot), then every 60 s
  setTimeout(() => {
    pollAppNotifications();
    setInterval(pollAppNotifications, 60 * 1000);
  }, 15000);

  // ── Auto-updater wiring ────────────────────────────────────────────────────
  if (autoUpdater && !isDev) {
    autoUpdater.on('checking-for-update', () => {
      mainWindow?.webContents.send('update-status', { phase: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('update-status', { phase: 'available', version: info.version });
      // autoDownload=true means the download starts automatically — no user action needed
      pushNotification({
        source: 'shell', type: 'update', icon: '🆕',
        title:  `🆕 SDC Tools v${info.version} available`,
        body:   'Downloading update in the background…',
      });
    });

    autoUpdater.on('update-not-available', () => {
      const payload = { phase: 'none' };
      _lastUpdateStatus = 'up-to-date'; // State Logic Builder sidebar format
      mainWindow?.webContents.send('update-status', payload);
      _broadcastToAppWindows('app-update-status', 'up-to-date');
    });

    autoUpdater.on('download-progress', ({ percent }) => {
      mainWindow?.webContents.send('update-status', { phase: 'downloading', percent: Math.round(percent) });
    });

    autoUpdater.on('update-downloaded', (info) => {
      const payload = { phase: 'ready', version: info.version };
      _lastUpdateStatus = 'restarting';
      mainWindow?.webContents.send('update-status', payload);
      _broadcastToAppWindows('app-update-status', 'restarting');
      // Notify the user — install happens when they click "Restart" or naturally quit
      pushNotification({
        source: 'shell', type: 'update', icon: '✅',
        title:  `✅ SDC Tools v${info.version} ready`,
        body:   'Update downloaded. Click "Restart & Install" in the launcher.',
      });
    });

    autoUpdater.on('error', (err) => {
      console.error('[updater] Error:', err.message);
      mainWindow?.webContents.send('update-status', { phase: 'error', message: err.message });
    });

    // Check on launch, then every 2 minutes
    autoUpdater.checkForUpdates().catch(e => console.warn('[updater] Check failed:', e.message));
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(e => console.warn('[updater] Periodic check failed:', e.message));
    }, 2 * 60 * 1000);
  }

  // ── IPC handlers ──────────────────────────────────────────────────────────
  // ── Notification IPC ──────────────────────────────────────────────────────
  ipcMain.handle('show-notification',     (_, opts) => pushNotification(opts));
  ipcMain.handle('get-notifications',     ()        => notificationStore);
  ipcMain.handle('dismiss-notification',  (_, id)   => {
    const i = notificationStore.findIndex(n => n.id === id);
    if (i !== -1) notificationStore.splice(i, 1);
    mainWindow?.webContents.send('notifications-updated', notificationStore);
    return true;
  });
  ipcMain.handle('clear-notifications',   ()        => {
    notificationStore.length = 0;
    mainWindow?.webContents.send('notifications-updated', notificationStore);
    return true;
  });
  ipcMain.handle('mark-notifications-read', ()      => {
    notificationStore.forEach(n => { n.read = true; });
    mainWindow?.webContents.send('notifications-updated', notificationStore);
    return true;
  });

  // ── Auth IPC ───────────────────────────────────────────────────────────────
  ipcMain.handle('auth-get-status', () => auth.getAuthStatus());
  ipcMain.handle('auth-login',      () => auth.login());
  ipcMain.handle('auth-logout',     () => auth.logout());

  ipcMain.handle('get-status',   () => processManager.getStatus());
  ipcMain.handle('get-logs',     (_, appId) => processManager.getLogs(appId));
  ipcMain.handle('open-app',     (_, appId) => openAppWindow(appId));
  ipcMain.handle('retry-app',    (_, appId) => processManager.restart(appId));
  ipcMain.handle('stop-all',     () => processManager.stopAll());
  ipcMain.handle('restart-all',  () => processManager.restartAll());
  ipcMain.handle('stop-app',     (_, appId) => processManager.stop(appId));
  ipcMain.handle('restart-app',  (_, appId) => processManager.restart(appId));
  ipcMain.handle('sync-status',  () => processManager.syncStatus());

  // Update: download is automatic (autoDownload=true). Install on user confirm.
  ipcMain.handle('check-for-updates', () => {
    if (autoUpdater && !isDev) {
      autoUpdater.checkForUpdates().catch(e => console.warn('[updater] Manual check failed:', e.message));
    }
  });
  ipcMain.handle('update-download', () => {
    // No-op — kept for UI compatibility. Download starts automatically.
  });
  ipcMain.handle('update-install', async () => {
    pendingUpdate = true;
    await performQuit();
  });
  ipcMain.handle('get-app-version',  () => app.getVersion());
  ipcMain.handle('get-server-host',  () => _serverHost);

  // Manually trigger an upstream update check for apps that have dedicated updaters
  ipcMain.handle('trigger-update', (_, appId) => {
    const TRIGGER_PORTS = { readiness: 4012, scheduler: 4013, statelogic: 4014 };
    const port = TRIGGER_PORTS[appId];
    if (!port) return { error: 'No updater for this app' };
    return new Promise((resolve) => {
      const req = require('http').request(
        { host: _serverHost, port, path: '/trigger', method: 'POST' },
        (res) => resolve({ ok: res.statusCode === 202 })
      );
      req.on('error', (e) => resolve({ error: e.message }));
      req.end();
    });
  });

  // ── Window controls ───────────────────────────────────────────────────────
  ipcMain.handle('window-minimize', () => mainWindow?.minimize());
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle('window-close', () => mainWindow?.close());

  // ── Startup with Windows ───────────────────────────────────────────────────
  ipcMain.handle('get-launch-on-startup', () => {
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('set-launch-on-startup', (_, enable) => {
    app.setLoginItemSettings({ openAtLogin: enable, openAsHidden: true });
    return app.getLoginItemSettings().openAtLogin;
  });

  // ── Global keyboard shortcuts ──────────────────────────────────────────────
  // Ctrl+1–4 open each app; Ctrl+0 shows the launcher.
  const appOrder = Object.keys(processManager.configs); // ['assemblies','readiness','scheduler','statelogic']
  appOrder.forEach((id, i) => {
    globalShortcut.register(`CommandOrControl+${i + 1}`, () => {
      mainWindow?.show();
      openAppWindow(id);
    });
  });
  globalShortcut.register('CommandOrControl+0', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
});

// ── Notification polling ──────────────────────────────────────────────────────
// Polls each app's /api/notifications/pending every 60 s and fires native toasts
// for upcoming calendar events. Also watches for app crashes.
const _serverHost = process.env.SDC_SERVER_HOST || 'localhost';
const APP_NOTIFICATION_ENDPOINTS = {
  calendar: `http://${_serverHost}:4005/api/notifications/pending?window=30`,
};
const firedReminders = new Set();
const lastAppState   = {};
// Prune firedReminders daily so it doesn't grow unbounded
setInterval(() => firedReminders.clear(), 24 * 60 * 60 * 1000);

async function pollAppNotifications() {
  // 1. Calendar upcoming events
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 5000);
    const res  = await fetch(APP_NOTIFICATION_ENDPOINTS.calendar, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const events = await res.json();
      if (Array.isArray(events)) {
        for (const ev of events) {
          const key = `cal_${ev.id}_${Math.floor((ev.minsUntil ?? 0) / 5)}`; // de-dup per 5-min bucket
          if (!firedReminders.has(key)) {
            firedReminders.add(key);
            pushNotification({
              source: 'calendar',
              type:   'reminder',
              icon:   '📅',
              title:  `📅 ${ev.title}`,
              body:   `Starting in ${ev.minsUntil} min${ev.location ? ' — ' + ev.location : ''}`,
            });
          }
        }
      }
    }
  } catch { /* calendar not running or timed out — silently skip */ }

  // 2. App crash detection
  const status = processManager.getStatus();
  for (const [id, s] of Object.entries(status)) {
    const prev = lastAppState[id];
    lastAppState[id] = s.status;
    if (prev && prev !== 'crashed' && s.status === 'crashed') {
      pushNotification({
        source: 'shell',
        type:   'crash',
        icon:   '⚠️',
        title:  `⚠️ ${s.name} stopped`,
        body:   'The app crashed unexpectedly. Click Retry in the launcher.',
      });
    }
    if (prev === 'crashed' && s.status === 'running') {
      pushNotification({
        source: 'shell',
        type:   'info',
        icon:   '✅',
        title:  `✅ ${s.name} recovered`,
        body:   'The app restarted successfully.',
      });
    }
  }
}

app.on('window-all-closed', () => {
  // Don't quit — tray keeps the app alive
});

app.on('before-quit', async (e) => {
  if (isQuitting) return;
  e.preventDefault();
  await performQuit();
});

process.on('unhandledRejection', (reason) => {
  console.error('[main] Unhandled rejection:', reason);
});
