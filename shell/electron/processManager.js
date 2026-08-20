/**
 * processManager.js — Remote server connection monitor for SDC Tools.
 *
 * Backends run on the company server PC managed by PM2.
 * This module pings their health endpoints and reports status to the UI.
 * No processes are spawned locally — the Electron shell is a pure thin client.
 *
 * Server host is read from SDC_SERVER_HOST in shell/.env.
 * Falls back to localhost so `npm run dev` still works for developers.
 */

'use strict';

const http         = require('http');
const EventEmitter = require('events');

const POLL_INTERVAL_MS = 20_000;  // re-check every 20 s
const PING_TIMEOUT_MS  =  3_000;  // give up after 3 s
const LOG_BUFFER_SIZE  =     50;

class ProcessManager extends EventEmitter {
  constructor() {
    super();
    this._statuses = {};
    this._logs     = {};
    this._polls    = {};  // { [id]: NodeJS.Timeout }
    this._configs  = null;
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  get configs() {
    if (!this._configs) this._configs = this._buildConfigs();
    return this._configs;
  }

  _buildConfigs() {
    // SDC_SERVER_HOST is set in shell/.env for production installs.
    // Developers leave it unset → falls back to localhost.
    const host = process.env.SDC_SERVER_HOST || 'localhost';
    const url  = (port) => `http://${host}:${port}`;

    return {
      assemblies: {
        id:          'assemblies',
        name:        'Assemblies Library',
        description: 'SolidWorks CAD assembly search & management',
        port:        4001,
        url:         url(4001),
        healthPath:  '/health',
        color:       '#1574C4',
        emoji:       '🔧',
        windowSize:  { width: 1280, height: 800 },
      },
      readiness: {
        id:          'readiness',
        name:        'Project Build Status Dashboard',
        description: 'ETO project build status dashboard',
        port:        4002,
        url:         url(4002),
        healthPath:  '/health',
        color:       '#74C415',
        emoji:       '📊',
        windowSize:  { width: 1400, height: 900 },
      },
      scheduler: {
        id:          'scheduler',
        name:        'Project Planner',
        description: 'Project Gantt charts & Smartsheet sync',
        port:        4003,
        url:         url(4003),
        healthPath:  '/health',
        color:       '#FFDE51',
        emoji:       '📅',
        windowSize:  { width: 1400, height: 900 },
      },
      statelogic: {
        id:          'statelogic',
        name:        'State Logic Builder',
        description: 'Seq diagrams → PLC generation',
        port:        4004,
        url:         url(4004),
        healthPath:  '/health',
        color:       '#AACEE8',
        emoji:       '⚡',
        windowSize:  { width: 1440, height: 900 },
      },
      calendar: {
        id:          'calendar',
        name:        'Calendar',
        description: 'Company-wide calendar — events, birthdays, paydays & Scheduler sync',
        port:        4005,
        url:         url(4005),
        healthPath:  '/api/health',
        color:       '#BEFA4F',
        emoji:       '📆',
        windowSize:  { width: 1440, height: 900 },
      },
      reports: {
        id:          'reports',
        name:        'SDC Projects Reports',
        description: '',
        port:        3010,
        url:         url(3010),
        healthPath:  '/api/health',
        color:       '#0f5a95',
        emoji:       '📈',
        windowSize:  { width: 1440, height: 900 },
      },
    };
  }

  // ── Public API ───────────────────────────────────────────────────────────────

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
        url:         cfg.url,
      }])
    );
  }

  getLogs(id) { return this._logs[id] || []; }

  /** Start monitoring all apps. Called once on Electron launch. */
  startAll() {
    for (const id of Object.keys(this.configs)) {
      this._setStatus(id, 'starting');
    }
    for (const id of Object.keys(this.configs)) {
      this._monitor(id);
    }
  }

  /** Re-check one app (user clicked Retry). */
  async start(id) {
    this._setStatus(id, 'starting');
    this._stopPoll(id);
    this._monitor(id);
  }

  /** Stop polling one app. Does NOT shut down the remote server. */
  async stop(id) {
    this._stopPoll(id);
    this._setStatus(id, 'stopped');
  }

  async stopAll()    { for (const id of Object.keys(this.configs)) await this.stop(id); }
  async restartAll() { for (const id of Object.keys(this.configs)) await this.start(id); }
  async restart(id)  { await this.start(id); }

  /** Force a one-shot status refresh (used by sync-status IPC). */
  async syncStatus() {
    await Promise.allSettled(
      Object.entries(this.configs).map(async ([id, cfg]) => {
        const up = await this._ping(cfg.url, cfg.healthPath);
        if (up  && this._statuses[id] !== 'running') this._setStatus(id, 'running');
        if (!up && this._statuses[id] === 'running') this._setStatus(id, 'error');
      })
    );
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  _monitor(id) {
    const cfg = this.configs[id];

    // Immediate check, then poll every POLL_INTERVAL_MS
    this._check(id, cfg);
    this._polls[id] = setInterval(() => this._check(id, cfg), POLL_INTERVAL_MS);
  }

  _stopPoll(id) {
    if (this._polls[id]) { clearInterval(this._polls[id]); delete this._polls[id]; }
  }

  async _check(id, cfg) {
    const up   = await this._ping(cfg.url, cfg.healthPath);
    const prev = this._statuses[id];

    if (up) {
      if (prev !== 'running') {
        const host = process.env.SDC_SERVER_HOST || 'localhost';
        this._log(id, `[${id}] Connected — ${cfg.url} (server: ${host})`);
        this._setStatus(id, 'running');
      }
    } else {
      if (prev !== 'error') {
        const host = process.env.SDC_SERVER_HOST || 'localhost';
        this._log(id, `[${id}] Cannot reach ${cfg.url}`);
        this._log(id, `[${id}] Make sure the SDC server (${host}) is online and PM2 is running.`);
        this._log(id, `[${id}] On the server run:  pm2 status`);
        this._setStatus(id, 'error');
      }
    }
  }

  _ping(baseUrl, healthPath) {
    const target = `${baseUrl}${healthPath || '/'}`;
    return new Promise(resolve => {
      try {
        const req = http.get(target, { timeout: PING_TIMEOUT_MS }, res => {
          res.resume();
          resolve(res.statusCode < 500);
        });
        req.on('error',   () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      } catch { resolve(false); }
    });
  }

  _setStatus(id, status) {
    this._statuses[id] = status;
    this.emit('status-change', this.getStatus());
  }

  _log(id, line) {
    if (!this._logs[id]) this._logs[id] = [];
    this._logs[id].push(line);
    if (this._logs[id].length > LOG_BUFFER_SIZE) this._logs[id].shift();
    this.emit('log', { id, line });
  }
}

module.exports = new ProcessManager();
