const path = require('path');
const fs = require('fs');

// Detect if we are running inside an Electron packaged app
const isPackaged = __dirname.includes('app.asar');

let ROOT = path.join(__dirname, '../..');
let SERVER_ROOT = path.join(__dirname, '..');

if (isPackaged) {
    const resourcesPath = process.resourcesPath;
    ROOT = path.join(resourcesPath, 'app.asar.unpacked');
    SERVER_ROOT = path.join(ROOT, 'server');
}

// ─── Shared network path ──────────────────────────────────────────────────────
const SHARED_BASE = process.env.SHARED_BASE || 'N:/_Assembilies_Library_Application';
const usingFallback = false;

if (!fs.existsSync(SHARED_BASE)) {
    console.warn(`[WARN] Network path not accessible: ${SHARED_BASE}. Database operations will fail until the drive is available.`);
}

const SQLITE_PATH = path.join(SHARED_BASE, 'assemblies.db');
const THUMB_DIR   = path.join(SHARED_BASE, 'thumbnails');

if (!fs.existsSync(THUMB_DIR)) {
    try { fs.mkdirSync(THUMB_DIR, { recursive: true }); } catch (_) {}
}

// ─── PowerShell extractor path ────────────────────────────────────────────────
const PS_EXTRACTOR = path.join(SERVER_ROOT, 'extract-thumbnail.ps1');

// Warn at startup if the script is missing (extraction will silently skip)
if (!fs.existsSync(PS_EXTRACTOR)) {
    console.warn(`[WARN] Thumbnail extractor script not found at: ${PS_EXTRACTOR}`);
    console.warn('[WARN] Thumbnail extraction will be disabled until the script is restored.');
}

module.exports = {
    DRIVES: {
        N: process.env.DRIVE_N || 'N:/',
        L: process.env.DRIVE_L || 'L:/',
    },
    SQLITE_PATH,
    THUMB_DIR,
    PS_EXTRACTOR,
    PORT: process.env.PORT || 3001,
    // Allow any origin — the IP-based middleware (localhost + LAN only) is the
    // real security boundary.  Electron's loadFile origin is 'null' (file://),
    // and LAN browsers also need access, so '*' is correct here.
    ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || '*',
    ROOT,
    SERVER_ROOT,
    SHARED_BASE,
    usingFallback,   // exposed so the API can surface a banner warning to the UI
};
