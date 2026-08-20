/**
 * PM2 Ecosystem Config — SDC Tools Server
 *
 * Run on the company server PC to manage all 5 backend services.
 *
 * ── First-time setup ─────────────────────────────────────────────────────────
 *   1. Install Node.js LTS  →  https://nodejs.org
 *   2. Install PM2          →  npm install -g pm2
 *   3. Clone / pull repo    →  git clone https://github.com/abhikamuju36-ui/SDC-Tools.git
 *   4. Install all deps     →  npm install  (from repo root)
 *   5. Start all apps       →  pm2 start ecosystem.config.js
 *   6. Save + auto-start    →  pm2 save  &&  pm2 startup
 *      (follow the printed command to register the Windows service)
 *
 * ── Daily use ────────────────────────────────────────────────────────────────
 *   pm2 status              → see all apps and their status
 *   pm2 logs                → tail all logs
 *   pm2 logs sdc-scheduler      → tail one app
 *   pm2 restart all             → restart everything (e.g. after git pull)
 *   pm2 restart sdc-scheduler   → restart one app
 *
 * ── Deploy an update ─────────────────────────────────────────────────────────
 *   Automatic: sdc-updater-hub polls GitHub every 2-5 min — no manual steps needed.
 *   Manual:    git pull && npm run deploy
 *   Shell app: electron-updater checks GitHub Releases every 30 min (OTA).
 *
 * ── Environment ──────────────────────────────────────────────────────────────
 *   Each app loads its own .env file via dotenv (from its cwd).
 *   Copy .env.example → each app's folder and fill in ETO SQL / MySQL creds.
 *   Shell-launcher specific: .env at repo root (SDC_SERVER_HOST, AZURE_*).
 *
 * ── Ports ────────────────────────────────────────────────────────────────────
 *   sdc-assemblies   4001    sdc-readiness   4002
 *   sdc-scheduler    4003    sdc-statelogic  4004    sdc-calendar  4005
 *
 *   Open these ports in Windows Firewall (inbound, TCP) for LAN access.
 * ─────────────────────────────────────────────────────────────────────────────
 */

module.exports = {
  apps: [

    // ── SDC Updater Hub ──────────────────────────────────────────────────────
    // Runs all 4 auto-updaters (monorepo, BRR, scheduler, statelogic) in one
    // process — see scripts/sdc-updater-hub.js for why this is safe (each
    // updater's own error handling is unchanged; only merged the OS process).
    // Replaces the old separate sdc-updater / sdc-brr-updater /
    // sdc-scheduler-updater / sdc-statelogic-updater PM2 apps.
    // Electron shell gets OTA updates separately via electron-updater + release.yml.
    {
      name:          'sdc-updater-hub',
      script:        'scripts/sdc-updater-hub.js',
      cwd:           'D:\\AI Projects\\Centrailized library',
      env: {
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
      },
      watch:         false,
      max_restarts:  5,
      restart_delay: 60000,
      max_memory_restart: '350M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── Assemblies Library ──────────────────────────────────────────────────
    {
      name:          'sdc-assemblies',
      script:        'server/index.js',
      cwd:           './Assembilies library main',
      env: {
        PORT:             '4001',
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
        // UNC paths so PM2 (which runs in its own session) can reach the shares
        // without needing drive letters mapped in the service session.
        SHARED_BASE: '\\\\stevendouglas.local\\dfs\\Company\\Job Folder\\_Assembilies_Library_Application',
        DRIVE_N:     '\\\\stevendouglas.local\\dfs\\Company\\Job Folder',
        DRIVE_L:     '\\\\stevendouglas.local\\dfs\\Company\\Job Archive',
      },
      watch:         false,
      max_restarts:  10,
      restart_delay: 3000,
      max_memory_restart: '300M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── Build Readiness Report ───────────────────────────────────────────────
    // (its auto-updater now runs inside sdc-updater-hub, not as a separate app)
    {
      name:          'sdc-readiness',
      script:        'server/index.js',
      cwd:           './Build_Readiness_Report',
      env: {
        PORT:             '4002',
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
        ETO_HOST:         'SERVER-APP1.stevendouglas.local',
        ETO_DATABASE:     'SDC',
        ETO_DOMAIN:       'stevendouglas',
        ETO_PORT:         '1433',
        // ETO_USER / ETO_PASSWORD: load from this app's own .env (cwd) via
        // dotenv — kept out of this git-tracked file. See .env.example.
        // (Smartsheet integration removed — superseded by SDC Scheduler.)
      },
      watch:         false,
      max_restarts:  10,
      restart_delay: 3000,
      max_memory_restart: '300M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── SDC Scheduler ───────────────────────────────────────────────────────
    // (its auto-updater now runs inside sdc-updater-hub, not as a separate app)
    {
      name:          'sdc-scheduler',
      script:        'server.js',
      cwd:           './SDC_Scheduler',
      env: {
        PORT:             '4003',
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
        // ── Total ETO bridge ── (ETO_USER/ETO_PASSWORD load from this app's own .env)
        ETO_HOST:         'SERVER-APP1.stevendouglas.local',
        ETO_DATABASE:     'SDC',
        ETO_PORT:         '1433',
        ETO_DOMAIN:       'stevendouglas',
        // ── Anthropic Claude assistant ──
        ANTHROPIC_API_KEY:    process.env.ANTHROPIC_API_KEY || '',
        ANTHROPIC_MODEL:      'claude-sonnet-4-6',
        ANTHROPIC_MAX_TOKENS: '1024',
        // mysqldump is not on PATH — use the full install path
        MYSQLDUMP_PATH: 'C:\\Program Files\\MySQL\\MySQL Server 9.7\\bin\\mysqldump.exe',
      },
      watch:         false,
      max_restarts:  10,
      restart_delay: 3000,
      max_memory_restart: '400M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── State Logic Builder ─────────────────────────────────────────────────
    {
      name:          'sdc-statelogic',
      script:        'server.js',
      cwd:           './state_logic_builder',
      env: {
        PORT:             '4004',
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
        // UNC path so PM2 Windows Service can reach the share without N: drive mapped
        STANDARDS_DIR:    '\\\\stevendouglas.local\\dfs\\Company\\Job Folder\\AI Folder\\State Logic Diagrams\\standards',
        // DB: MySQL via mysqlDb.js (replaced the old Azure SQL path — see mysqlDb.js header)
      },
      watch:         false,
      max_restarts:  10,
      restart_delay: 3000,
      max_memory_restart: '300M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── SDC Calendar ────────────────────────────────────────────────────────
    // (state_logic_builder's auto-updater now runs inside sdc-updater-hub too)
    {
      name:          'sdc-calendar',
      script:        'server/server.js',
      cwd:           './SDC Centrailzed calender',
      env: {
        PORT:             '4005',
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
        // Legacy flag (2026-08-20): no longer bypasses authentication — real
        // per-user identity now comes from the shared sdc_session cookie
        // (server/middleware/requireAuth.js). Only still skips setting up
        // express-session, which the unused standalone Azure OAuth flow
        // needed. SDC_SESSION_SECRET is read from this app's own .env, same
        // as the other 4 SDC Tools apps.
        SKIP_AUTH:        'true',
        // Update to the actual server hostname/IP so calendar links work correctly
        FRONTEND_URL:     'http://SERVER-APP1:4005',
        SERVER_IP:        'SERVER-APP1',
      },
      watch:         false,
      max_restarts:  10,
      restart_delay: 3000,
      max_memory_restart: '300M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

  ],
};
