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
 *   pm2 logs scheduler      → tail one app
 *   pm2 restart all         → restart everything (e.g. after git pull)
 *   pm2 restart scheduler   → restart one app
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
 *   assemblies   4001    BRR          4002
 *   scheduler    4003    statelogic   4004    calendar  4005
 *
 *   Open these ports in Windows Firewall (inbound, TCP) for LAN access.
 * ─────────────────────────────────────────────────────────────────────────────
 */

module.exports = {
  apps: [

    // ── SDC Tools Server Auto-Updater ───────────────────────────────────────
    // Polls GitHub every 5 min for new commits on master.
    // On change: git pull → npm install → npm run deploy (build + pm2 restart all).
    // Covers all 5 server-hosted apps automatically.
    // Electron shell gets OTA updates separately via electron-updater + release.yml.
    {
      name:          'sdc-updater',
      script:        'scripts/server-auto-update.js',
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
      name:          'assemblies',
      script:        'server/index.js',
      cwd:           './Assembilies library main',
      env: {
        PORT:             '4001',
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
        // UNC path so PM2 (which runs in its own session) can reach the share
        // without needing N: drive mapped in the service session.
        SHARED_BASE: '\\\\stevendouglas.local\\dfs\\Company\\Job Folder\\_Assembilies_Library_Application',
      },
      watch:         false,
      max_restarts:  10,
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── Build Readiness Report ───────────────────────────────────────────────
    {
      name:          'readiness',
      script:        'server/index.js',
      cwd:           './Build_Readiness_Report',
      env: {
        PORT:             '4002',
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
      },
      watch:         false,
      max_restarts:  10,
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },

    // ── SDC Scheduler ───────────────────────────────────────────────────────
    {
      name:          'scheduler',
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
      name:          'statelogic',
      script:        'server.js',
      cwd:           './state_logic_builder',
      env: {
        PORT:             '4004',
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
        // Update this path if the standards drive is mapped differently on the server
        STANDARDS_DIR:    'N:\\AI Folder\\State Logic Diagrams\\standards',
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
      name:          'statelogic-updater',
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

    // ── SDC Calendar ────────────────────────────────────────────────────────
    {
      name:          'calendar',
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
