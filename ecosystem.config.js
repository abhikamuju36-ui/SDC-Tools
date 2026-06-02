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
 *   Automatic: sdc-updater polls GitHub every 5 min — no manual steps needed.
 *   Manual:    git pull && npm run deploy
 *   Shell app: electron-updater checks GitHub Releases every 30 min (OTA).
 *
 * ── Environment ──────────────────────────────────────────────────────────────
 *   Each app loads its own .env file via dotenv (from its cwd).
 *   Copy .env.example → each app's folder and fill in AZURE_SQL_* creds.
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

    // ── SDC Tools Server Auto-Updater ───────────────────────────────────────
    // Polls GitHub every 5 min for new commits on master.
    // On change: selectively checkouts only monorepo-owned files (skips
    // SDC_Scheduler/ and state_logic_builder/ — managed by per-app updaters),
    // then restarts: assemblies, readiness, calendar, vendor.
    // Electron shell gets OTA updates separately via electron-updater + release.yml.
    {
      name:          'sdc-updater',
      script:        'scripts/sdc-main-updater.js',
      cwd:           '.',
      env: {
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
      },
      watch:         false,
      max_restarts:  5,
      restart_delay: 60000,
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
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── Build Readiness Report — Auto-Updater ──────────────────────────────
    // Polls abhikamuju36-ui/Build_Readiness_Report every 2 min for new commits.
    // Replaces client/, server/routes/, server/services/, server/lib/ and restarts sdc-readiness.
    // Preserves server/index.js (health endpoint, startServer export) and server/cache/.
    {
      name:          'sdc-brr-updater',
      script:        'scripts/sdc-brr-updater.js',
      cwd:           './Build_Readiness_Report',
      env: {
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
      },
      watch:         false,
      max_restarts:  5,
      restart_delay: 60000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── Build Readiness Report ───────────────────────────────────────────────
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
        ETO_USER:         'akamuju',
        ETO_PASSWORD:     'Voltages84gilds$',
        ETO_DOMAIN:       'stevendouglas',
        ETO_PORT:         '1433',
        SMARTSHEET_API_KEY: 'pcqWtWqlXGJfagKlXBaTCDiWMCgMAdFP0i7TA',
      },
      watch:         false,
      max_restarts:  10,
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── SDC Scheduler — Auto-Updater ────────────────────────────────────────
    // Polls danbelliveau2/SDC_Scheduler every 5 min for new commits.
    // Replaces public/, db.js and restarts sdc-scheduler.
    // Preserves server.js (compression, azureSync, /health), azureDb.js, *.db files.
    {
      name:          'sdc-scheduler-updater',
      script:        'scripts/server-auto-update.js',
      cwd:           './SDC_Scheduler',
      env: {
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
      },
      watch:         false,
      max_restarts:  5,
      restart_delay: 60000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── SDC Scheduler — Repo Sync ───────────────────────────────────────────
    // After sdc-scheduler-updater pulls new files from danbelliveau2/SDC_Scheduler,
    // this job commits and pushes those changes to the centralized library repo
    // so the two repos stay in sync. Runs every 2 min alongside the updater.
    {
      name:          'sdc-scheduler-repo-sync',
      script:        'scripts/repo-sync.js',
      cwd:           './SDC_Scheduler',
      env: {
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
      },
      watch:         false,
      max_restarts:  5,
      restart_delay: 60000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── SDC Scheduler ───────────────────────────────────────────────────────
    {
      name:          'sdc-scheduler',
      script:        'server.js',
      cwd:           './SDC_Scheduler',
      env: {
        PORT:             '4003',
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
      },
      watch:         false,
      max_restarts:  10,
      restart_delay: 3000,
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
        // Azure SQL — same instance used by all SDC services
        AZURE_SQL_SERVER:   'sdc-automation.database.windows.net',
        AZURE_SQL_DATABASE: 'free-sql-db-7038618',
        AZURE_SQL_USER:     'sdcadmin',
        AZURE_SQL_PASSWORD: 'Voltages84gilds$',
      },
      watch:         false,
      max_restarts:  10,
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── State Logic Builder — Auto-Updater ─────────────────────────────────
    // Mirrors electron-updater: checks Dan's GitHub releases every 5 min,
    // pulls src/ + public/ + index.html, rebuilds, and restarts statelogic.
    {
      name:          'sdc-statelogic-updater',
      script:        'scripts/server-auto-update.js',
      cwd:           './state_logic_builder',
      env: {
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
      },
      watch:         false,
      max_restarts:  5,
      restart_delay: 60000,   // wait 1 min before restarting on crash
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── Vendor Tracker ──────────────────────────────────────────────────────
    {
      name:          'sdc-vendor',
      script:        'server/server.js',
      cwd:           './Vendors tracking dashboard',
      env: {
        PORT:             '4006',
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
        ETO_HOST:         'SERVER-APP1.stevendouglas.local',
        ETO_DATABASE:     'SDC',
        ETO_USER:         'akamuju',
        ETO_PASSWORD:     'Voltages84gilds$',
        ETO_DOMAIN:       'stevendouglas',
        ETO_PORT:         '1433',
        SMARTSHEET_API_KEY: 'pcqWtWqlXGJfagKlXBaTCDiWMCgMAdFP0i7TA',
      },
      watch:         false,
      max_restarts:  10,
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── SDC Calendar ────────────────────────────────────────────────────────
    {
      name:          'sdc-calendar',
      script:        'server/server.js',
      cwd:           './SDC Centrailzed calender',
      env: {
        PORT:             '4005',
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
        SKIP_AUTH:        'true',
        // Update to the actual server hostname/IP so calendar links work correctly
        FRONTEND_URL:     'http://SERVER-APP1:4005',
        SERVER_IP:        'SERVER-APP1',
      },
      watch:         false,
      max_restarts:  10,
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

  ],
};
