/**
 * processManager.js — In-process backend manager for SDC Tools.
 *
 * Each sub-app backend runs directly inside the Electron main process via
 * require() + startServer({ port }), NOT as a spawned child process.
 *
 * Why in-process?
 *   - No system Node.js dependency on end-user machines
 *   - No MODULE_VERSION mismatch (Electron's bundled Node.js is always used)
 *   - Instant startup — no process spawn overhead
 *   - Clean restart: just close the HTTP server and call startServer() again
 *
 * Health checks still use HTTP pings to localhost (same as before) so the
 * status/log logic is unchanged from the shell UI's perspective.
 */

'use strict';

const http         = require('http');
const net          = require('net');
const path         = require('path');
const fs           = require('fs');
const EventEmitter = require('events');

const LOG_BUFFER_SIZE   = 200;
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_BACKOFF_MS   = [2000, 5000, 15000];
const STARTUP_STAGGER_MS   = 1500;

class ProcessManager extends EventEmitter {
  constructor() {
    super();
    this._servers        = {};   // { [id]: http.Server }     — in-process servers
    this._processes      = {};   // { [id]: ChildProcess }    — spawn-fallback processes
    this._modules        = {};   // { [id]: { startServer } } — cached after first load
    this._spawnFallback  = new Set(); // ids that must use spawn due to native module mismatch
    this._statuses       = {};
    this._logs           = {};
    this._restartCounts  = {};
    this._stoppingIds    = new Set();
    this._configs        = null;
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  get configs() {
    if (!this._configs) this._configs = this._buildConfigs();
    return this._configs;
  }

  _buildConfigs() {
    const { app } = require('electron');
    const isPackaged = app.isPackaged;

    const getDir = (devFolder, prodFolder) =>
      isPackaged
        ? path.join(process.resourcesPath, 'apps', prodFolder)
        : path.join(__dirname, '../..', devFolder);

    const schedulerDir = getDir('SDC_Scheduler', 'scheduler');

    return {
      assemblies: {
        id:          'assemblies',
        name:        'Assemblies Library',
        description: 'SolidWorks CAD assembly search & management',
        port:        4001,
        dir:         getDir('Assembilies library main', 'assemblies'),
        mainFile:    'server/index.js',
        color:       '#1574C4',
        emoji:       '🔧',
        windowSize:  { width: 1280, height: 800 },
        startupTimeout: 90,
        healthPath:  '/health',
      },
      readiness: {
        id:          'readiness',
        name:        'Build Readiness Report',
        description: 'ETO project build status dashboard',
        port:        4002,
        dir:         getDir('Build_Readiness_Report', 'readiness'),
        mainFile:    'server/index.js',
        color:       '#74C415',
        emoji:       '📊',
        windowSize:  { width: 1400, height: 900 },
        startupTimeout: 45,
        healthPath:  '/health',
      },
      scheduler: {
        id:          'scheduler',
        name:        'SDC Scheduler',
        description: 'Project Gantt charts & Smartsheet sync',
        port:        4003,
        dir:         schedulerDir,
        mainFile:    'server.js',
        color:       '#FFDE51',
        emoji:       '📅',
        windowSize:  { width: 1400, height: 900 },
        startupTimeout: 45,
        healthPath:  '/health',
        env:         { NODE_NO_WARNINGS: '1' },
      },
      statelogic: {
        id:          'statelogic',
        name:        'State Logic Builder',
        description: 'PLC state machine → Allen-Bradley L5X',
        port:        4004,
        dir:         getDir('state_logic_builder', 'statelogic'),
        mainFile:    'server.js',
        color:       '#AACEE8',
        emoji:       '⚡',
        windowSize:  { width: 1440, height: 900 },
        startupTimeout: 45,
        healthPath:  '/health',
        env: {
          STANDARDS_DIR: process.env.STANDARDS_DIR
            || 'N:\\AI Folder\\State Logic Diagrams\\standards',
        },
      },
      calendar: {
        id:          'calendar',
        name:        'SDC Calendar',
        description: 'Company-wide calendar — events, birthdays, paydays & Scheduler sync',
        port:        4005,
        dir:         getDir('SDC Centrailzed calender', 'calendar'),
        mainFile:    'server/server.js',
        color:       '#BEFA4F',
        emoji:       '📆',
        windowSize:  { width: 1440, height: 900 },
        startupTimeout: 60,
        healthPath:  '/api/health',
        env: {
          FRONTEND_URL:      'http://localhost:4005',
          SKIP_AUTH:         'true',
          TEAMS_WEBHOOK_URL: process.env.TEAMS_WEBHOOK_URL || '',
          // Scheduler sync now reads from Azure SQL [scheduler].[tasks]
          // — no local SQLite path needed.
        },
      },
    };
  }

  // ── Public API (unchanged shape — shell UI still works) ────────────────────

  getStatus() {
    return Object.fromEntries(
      Object.entries(this.configs).map(([id, cfg]) => [id, {
        id:          cfg.id,
        name:        cfg.name,
        description: cfg.description,
        port:        cfg.port,
        color:       cfg.color,
        emoji:       cfg.emoji,
        windowSize:  cfg.windowSize,
        status:      this._statuses[id] || 'stopped',
        url:         `http://localhost:${cfg.port}`,
      }])
    );
  }

  getLogs(id)   { return this._logs[id] || []; }

  async syncStatus() {
    await Promise.allSettled(
      Object.entries(this.configs).map(async ([id, cfg]) => {
        const up = await this._ping(cfg.port, cfg.healthPath);
        const cur = this._statuses[id];
        if (up  && cur !== 'running') this._setStatus(id, 'running');
        if (!up && cur === 'running' && !this._servers[id]) this._setStatus(id, 'stopped');
      })
    );
  }

  async startAll() {
    const ids = Object.keys(this.configs);
    for (const id of ids) {
      if (!this._statuses[id]) this._setStatus(id, 'starting');
    }
    for (let i = 0; i < ids.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, STARTUP_STAGGER_MS));
      this.start(ids[i]).catch(err => {
        console.error(`[processManager] Failed to start ${ids[i]}:`, err.message);
        this._setStatus(ids[i], 'error');
      });
    }
  }

  async stopAll() {
    const ids = new Set([...Object.keys(this._servers), ...Object.keys(this._processes)]);
    await Promise.allSettled([...ids].map(id => this.stop(id)));
  }
  async restartAll() { await this.stopAll(); await this.startAll(); }
  async restart(id)  { await this.stop(id); this._restartCounts[id] = 0; await this.start(id); }

  // ── Start ───────────────────────────────────────────────────────────────────

  async start(id) {
    const cfg = this.configs[id];
    if (!cfg) throw new Error(`Unknown app: ${id}`);

    this._setStatus(id, 'starting');

    // Close any existing server first
    if (this._servers[id]) await this.stop(id);

    // Verify directory exists
    const mainPath = path.join(cfg.dir, cfg.mainFile);
    if (!fs.existsSync(cfg.dir)) {
      return this._fail(id, `Directory not found: ${cfg.dir}`);
    }
    if (!fs.existsSync(mainPath)) {
      return this._fail(id, `Entry file not found: ${mainPath}`);
    }

    // Warn if the N:\ standards drive is unreachable (statelogic only)
    if (cfg.env && cfg.env.STANDARDS_DIR) {
      const drive = cfg.env.STANDARDS_DIR.slice(0, 3);
      if (!fs.existsSync(drive)) {
        this._appendLog(id, `[${id}] WARNING: Standards drive ${drive} not reachable — will use local fallback`);
      }
    }

    // Port check — same logic as before
    const portFree = await this._isPortFree(cfg.port);
    if (!portFree) {
      const isOurs = await this._ping(cfg.port, cfg.healthPath);
      if (isOurs) {
        this._appendLog(id, `[${id}] Port ${cfg.port} already responding — assuming running`);
        this._setStatus(id, 'running');
        return;
      }
      return this._fail(id, `Port ${cfg.port} occupied by another process`);
    }

    // If this app previously failed with a native module mismatch, skip the
    // in-process path entirely and go straight to spawn (avoids repeated errors).
    if (this._spawnFallback.has(id)) {
      this._appendLog(id, `[${id}] Using spawn fallback (native module incompatible — rebuild to fix)`);
      return this._startSpawn(id, cfg);
    }

    // Set env vars before loading the module (module-level PORT vars read these)
    const envBefore = this._applyEnv({ PORT: String(cfg.port), NODE_ENV: 'production', ...(cfg.env || {}) });

    try {
      // Load (or reuse cached) module
      if (!this._modules[id]) {
        this._appendLog(id, `[${id}] Loading module: ${mainPath}`);
        const mod = require(mainPath);
        if (typeof mod.startServer !== 'function') {
          throw new Error(`${mainPath} does not export startServer(). Did you add the in-process wrapper?`);
        }
        this._modules[id] = mod;
      }

      const { startServer } = this._modules[id];
      this._appendLog(id, `[${id}] Starting on port ${cfg.port}`);
      const server = startServer({ port: cfg.port });
      this._servers[id] = server;
      this._restartCounts[id] = this._restartCounts[id] || 0;

      // Detect unexpected server close (crash/error) and auto-restart
      server.once('close', () => {
        if (this._stoppingIds.has(id)) {
          this._stoppingIds.delete(id);
          delete this._servers[id];
          this._setStatus(id, 'stopped');
          return;
        }
        delete this._servers[id];
        this._handleCrash(id, 'server-close');
      });

    } catch (e) {
      this._restoreEnv(envBefore);

      // Native module mismatch (e.g. better-sqlite3 compiled for a different
      // Node version). Detect via multiple signals because Electron doesn't
      // always set e.code = 'ERR_DLOPEN_FAILED' — the version-check error has
      // no code at all on some Electron builds, so we also test the full string.
      const errStr = String(e) + (e.message || '');
      const isNativeMismatch =
        e.code === 'ERR_DLOPEN_FAILED'   ||
        errStr.includes('NODE_MODULE_VERSION')  ||
        errStr.includes('was compiled against') ||
        errStr.includes('native')               ||
        errStr.includes('.node');

      if (isNativeMismatch) {
        this._appendLog(id, `[${id}] Native module incompatible with Electron's Node — falling back to spawn`);
        this._appendLog(id, `[${id}] TIP: Run "npm run rebuild-native" in the shell folder to fix this permanently`);
        console.warn(`[processManager] ${id}: native module mismatch — using spawn fallback`);
        // Mark so future restarts skip the require() attempt entirely.
        this._spawnFallback.add(id);
        // Clear the broken entry from Node's require cache.
        try {
          Object.keys(require.cache).forEach(k => {
            if (k.startsWith(cfg.dir)) delete require.cache[k];
          });
        } catch (_) {}
        return this._startSpawn(id, cfg);
      }

      return this._fail(id, `Failed to require/start: ${e.message}`);
    }

    this._restoreEnv(envBefore);

    const ready = await this._waitForReady(id, cfg.port, cfg.healthPath, cfg.startupTimeout || 45);
    if (!ready) this._setStatus(id, 'error');
  }

  // ── Stop ────────────────────────────────────────────────────────────────────

  async stop(id) {
    // Handle spawn-fallback processes
    const proc = this._processes[id];
    if (proc) {
      this._stoppingIds.add(id);
      return new Promise(resolve => {
        const kill = setTimeout(() => {
          try {
            if (process.platform === 'win32') {
              require('child_process').spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { shell: true, stdio: 'ignore' });
            } else { proc.kill('SIGKILL'); }
          } catch (_) {}
          resolve();
        }, 5000);
        proc.once('exit', () => { clearTimeout(kill); resolve(); });
        try { proc.kill('SIGTERM'); } catch (_) { clearTimeout(kill); resolve(); }
      });
    }

    const server = this._servers[id];
    if (!server) return;
    this._stoppingIds.add(id);

    return new Promise(resolve => {
      const forceKill = setTimeout(() => {
        try {
          // closeAllConnections() is available in Node 18.2+ / Electron 34+
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          server.close(() => resolve());
        } catch (_) { resolve(); }
      }, 5000);

      server.close(() => {
        clearTimeout(forceKill);
        resolve();
      });

      // Also kill keep-alive connections so close() resolves quickly
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    });
  }

  // ── Crash / restart ─────────────────────────────────────────────────────────

  _handleCrash(id, reason) {
    const attempt = this._restartCounts[id] || 0;
    if (attempt >= MAX_RESTART_ATTEMPTS) {
      const msg = `[${id}] Crashed (${reason}) — max restart attempts reached`;
      console.error(msg);
      this._appendLog(id, msg);
      this._setStatus(id, 'error');
      return;
    }
    const delay = RESTART_BACKOFF_MS[attempt] || 15000;
    const msg = `[${id}] Crashed (${reason}) — restarting in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RESTART_ATTEMPTS})`;
    console.warn(msg);
    this._appendLog(id, msg);
    this._restartCounts[id] = attempt + 1;
    setTimeout(() => this.start(id), delay);
  }

  // ── Health check & port utils ────────────────────────────────────────────────

  async _waitForReady(id, port, healthPath, maxSeconds) {
    const attempts = maxSeconds * 2;
    for (let i = 0; i < attempts; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await this._ping(port, healthPath)) {
        this._setStatus(id, 'running');
        this._restartCounts[id] = 0;
        return true;
      }
    }
    this._appendLog(id, `[${id}] Did not respond within ${maxSeconds}s`);
    return false;
  }

  _ping(port, healthPath) {
    const tryPath = (p) => new Promise(resolve => {
      const req = http.get(
        { hostname: 'localhost', port, path: p, timeout: 1000 },
        res => { res.resume(); resolve(res.statusCode < 500); }
      );
      req.on('error',   () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (!healthPath) return tryPath('/');
    return tryPath(healthPath).then(ok => ok ? true : tryPath('/'));
  }

  _isPortFree(port) {
    return new Promise(resolve => {
      const srv = net.createServer();
      srv.once('error',     () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(port, '127.0.0.1');
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _fail(id, msg) {
    const line = `[${id}] ERROR: ${msg}`;
    console.error(line);
    this._appendLog(id, line);
    this._setStatus(id, 'error');
  }

  _appendLog(id, line) {
    if (!this._logs[id]) this._logs[id] = [];
    this._logs[id].push(line);
    if (this._logs[id].length > LOG_BUFFER_SIZE) this._logs[id].shift();
    this.emit('log', { id, line });
  }

  _setStatus(id, status) {
    this._statuses[id] = status;
    this.emit('status-change', this.getStatus());
  }

  // ── Spawn fallback (used when native modules can't load in-process) ─────────
  // Uses the system node.exe so better-sqlite3 (compiled for system Node) works.
  // Temporary — runs until @electron/rebuild fixes the native module.

  _startSpawn(id, cfg) {
    const { spawn } = require('child_process');
    const nodeBin = process.platform === 'win32' ? 'node.exe' : 'node';
    const mainPath = path.join(cfg.dir, cfg.mainFile);

    const proc = spawn(nodeBin, [mainPath], {
      cwd: cfg.dir,
      env: { ...process.env, PORT: String(cfg.port), NODE_ENV: 'production', ...(cfg.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    proc.stdout.on('data', d => this._appendLog(id, `[${id}] ${d.toString().trimEnd()}`));
    proc.stderr.on('data', d => this._appendLog(id, `[${id}][ERR] ${d.toString().trimEnd()}`));
    proc.on('error', err => this._fail(id, `Spawn error: ${err.message}`));
    proc.on('exit', (code) => {
      delete this._processes[id];
      if (!this._stoppingIds.has(id) && code !== 0) this._handleCrash(id, `exit ${code}`);
      else { this._stoppingIds.delete(id); this._setStatus(id, 'stopped'); }
    });

    // Store under _processes (not _servers) so stop() can kill it
    this._processes[id] = proc;
    this._restartCounts[id] = this._restartCounts[id] || 0;

    // Reuse the same health-check wait
    this._waitForReady(id, cfg.port, cfg.healthPath, cfg.startupTimeout || 45)
      .then(ready => { if (!ready) this._setStatus(id, 'error'); });
  }

  /** Apply env overrides; return the previous values for restore. */
  _applyEnv(overrides) {
    const prev = {};
    for (const [k, v] of Object.entries(overrides)) {
      prev[k] = process.env[k];
      process.env[k] = v;
    }
    return prev;
  }

  _restoreEnv(prev) {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

module.exports = new ProcessManager();
