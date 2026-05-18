const { app, BrowserWindow, ipcMain, globalShortcut, shell, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const isDev = process.env.NODE_ENV === 'development';
const { fork } = require('child_process');

let mainWindow;
let serverProcess;
let autoUpdater = null; // lazy-loaded after app.ready to avoid pre-ready crash

// Resolved at startup; exposed to renderer via 'get-api-base-sync' IPC.
// In dev the Vite proxy handles /api/* so an empty string is correct.
let resolvedApiBase = isDev ? '' : 'http://127.0.0.1:3001';

// ─── IPC: synchronous API-base query (called from preload before React boots) ──
ipcMain.on('get-api-base-sync', (event) => {
    event.returnValue = resolvedApiBase;
});

function waitForServer(baseUrl, timeout = 45000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeout;
        const check = () => {
            http.get(`${baseUrl}/api/assemblies/status`, (res) => {
                res.resume();
                resolve();
            }).on('error', () => {
                if (Date.now() > deadline) {
                    reject(new Error('Server did not start in time'));
                } else {
                    setTimeout(check, 300);
                }
            });
        };
        setTimeout(check, 500);
    });
}

function getRemoteServerUrl() {
    try {
        const configPath = 'N:/_Assembilies_Library_Application/app-config.json';
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.serverUrl) return config.serverUrl;
        }
    } catch (_) {}
    return null;
}

function startBackend() {
    let serverPath = path.join(app.getAppPath(), 'server/index.js');

    if (!isDev) {
        serverPath = serverPath.replace('app.asar', 'app.asar.unpacked');
    }

    console.log('Starting backend at:', serverPath);

    serverProcess = fork(serverPath, [], {
        env: { ...process.env, PORT: 3001, ELECTRON_RUN_AS_NODE: '1' }
    });

    serverProcess.on('error', (err) => {
        console.error('Failed to start backend:', err);
    });

    serverProcess.on('exit', (code) => {
        console.log(`Backend exited with code ${code}`);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        icon: path.join(__dirname, '../client/public/app-icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        title: 'SDC Assemblies Library',
        backgroundColor: '#FAFAF9',
        show: false,
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('Failed to load:', validatedURL, errorCode, errorDescription);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Prevent window.open() from spawning a blank Electron window.
    // All external links must go through shell.openExternal via IPC instead.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });
}

app.whenReady().then(async () => {
    createWindow();

    // Register Ctrl+Shift+I / F12 to open DevTools for diagnostics
    globalShortcut.register('CommandOrControl+Shift+I', () => {
        if (mainWindow) mainWindow.webContents.toggleDevTools();
    });
    globalShortcut.register('F12', () => {
        if (mainWindow) mainWindow.webContents.toggleDevTools();
    });

    if (!isDev) {
        // Lazy-load electron-updater only in production, after app is ready
        ({ autoUpdater } = require('electron-updater'));
        autoUpdater.on('update-available', () => console.log('Update available.'));
        autoUpdater.on('update-downloaded', () => {
            console.log('Update downloaded; will install on next quit.');
            autoUpdater.quitAndInstall();
        });

        // Show loading screen while server / network comes up
        mainWindow.loadFile(path.join(__dirname, 'loading.html'));

        // Resolve where the API lives (remote LAN server or local fallback)
        const remoteUrl = getRemoteServerUrl();
        resolvedApiBase = remoteUrl || 'http://127.0.0.1:3001';

        if (!remoteUrl) {
            // No shared server configured — start a local Express backend
            startBackend();
        }

        try {
            await waitForServer(resolvedApiBase);
        } catch (err) {
            console.error('Server startup timeout:', err.message);
            const hint = remoteUrl
                ? `Could not reach server at <code>${remoteUrl}</code>. Check that the server PC is on and reachable.`
                : `Check the log at <code>%APPDATA%\\SDC-Assemblies-Library\\sdc-library.log</code> for details.`;
            mainWindow.loadURL(`data:text/html,<html><body style="background:#FAFAF9;font-family:sans-serif;padding:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;box-sizing:border-box;">
                <h1 style="color:#B42318;margin:0 0 12px;">Server Failed to Start</h1>
                <p style="color:#44403C;margin:0 0 8px;">The SDC database server could not be reached after 45 seconds.</p>
                <p style="font-size:12px;color:#78716C;margin:0 0 20px;">${hint}</p>
                <button onclick="location.reload()" style="padding:8px 20px;cursor:pointer;font-size:14px;">Retry</button>
            </body></html>`);
            return;
        }

        // ── Always load the UI from the locally bundled React app ──────────────
        // The React app reads window.electron.apiBase (injected by preload) and
        // directs all /api/* fetch calls to resolvedApiBase at runtime.
        mainWindow.loadFile(path.join(app.getAppPath(), 'client/dist/index.html'));

        autoUpdater.checkForUpdatesAndNotify();

        // Re-check for updates every 5 minutes — installs automatically when downloaded
        setInterval(() => {
            autoUpdater.checkForUpdatesAndNotify().catch(err =>
                console.error('Periodic update check failed:', err)
            );
        }, 5 * 60 * 1000);

    } else {
        // Dev: Vite serves the frontend; it proxies /api/* to localhost:3001
        mainWindow.loadURL('http://localhost:5173');
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (serverProcess) serverProcess.kill();
        app.quit();
    }
});

app.on('quit', () => {
    globalShortcut.unregisterAll();
    if (serverProcess) serverProcess.kill();
});

// ─── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('check-for-updates', async () => {
    if (isDev || !autoUpdater) {
        return { success: false, message: 'Update check is only available in the packaged app.' };
    }
    try {
        const result = await autoUpdater.checkForUpdatesAndNotify();
        return { success: true, message: 'Checking for updates...', result };
    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('open-path', async (event, filePath) => {
    return new Promise((resolve) => {
        const { execFile } = require('child_process');
        execFile('cmd.exe', ['/c', 'start', '', filePath], { shell: false }, (err) => {
            if (err) {
                console.error('[open-path] failed:', err.message);

                // Detect "file not found" vs a real system error
                const notFound = /cannot find the file|does not exist|no such file/i.test(err.message);
                if (notFound) {
                    dialog.showMessageBox(mainWindow, {
                        type: 'warning',
                        title: 'File Not Found',
                        message: 'The file could not be found at the stored path.',
                        detail: `Path: ${filePath}\n\nThe file may have been moved, renamed, or deleted since the last sync.\n\nTip: click "Sync Now" in the library to refresh the file links.`,
                        buttons: ['OK'],
                    });
                } else {
                    dialog.showMessageBox(mainWindow, {
                        type: 'error',
                        title: 'Could Not Open File',
                        message: 'Failed to open the file.',
                        detail: `Path: ${filePath}\n\nError: ${err.message}`,
                        buttons: ['OK'],
                    });
                }
                resolve({ success: false, error: err.message });
            } else {
                resolve({ success: true });
            }
        });
    });
});

// Open any http/https URL in the system default browser (not a new Electron window)
ipcMain.handle('open-external', async (event, url) => {
    try {
        await shell.openExternal(url);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});
