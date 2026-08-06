/**
 * PM2 Ecosystem Config — SDC Projects Reports (standalone)
 *
 * Next.js 16 app (Prisma/MySQL) on port 3010. Runs as its own PM2 app under the
 * same interactive-user PM2 daemon as the rest of the SDC Tools estate, so it
 * survives an RDP session closing / a reboot (with `pm2 save` + startup).
 *
 * The Scheduler team board calls this app's /api/integration/employees, so it
 * must be running for the board's Unassigned/Inactive cards to populate.
 *
 * ── Deploy ─────────────────────────────────────────────────────────────────
 *   First time:          pm2 start ecosystem.config.js && pm2 save
 *   After a code change: npm run deploy        <-- build, free 3010, pm2 restart
 *
 * ── Use `npm run deploy`, not `pm2 restart` on its own (§71) ────────────────
 *
 * PM2 on this Windows box does NOT reliably kill this app's server process. Measured
 * 2026-08-06, three times in twenty minutes: `pm2 stop`, `pm2 restart` and `pm2 delete`
 * each reported success while the `next start` server kept running and kept the socket.
 * The replacement instance then crash-loops on EADDRINUSE every ~4s — while the OLD
 * BUILD CARRIES ON SERVING. So the deploy looks like it worked, the site looks up, and
 * the new code is simply not live, with nothing to announce it. (The `↺ 364` this entry
 * had accumulated was that loop, over many deploys.)
 *
 * `npm run deploy` frees 3010 explicitly between the build and the restart, and FAILS
 * LOUDLY if a process there survives — see scripts/free-port.mjs. If you do restart by
 * hand, check `pm2 logs sdc-etc-planner --err` for EADDRINUSE before believing it.
 *
 * Stop any dev server on 3010 (`npm run dev`) before deploying either way.
 *
 * Env: Next.js auto-loads this folder's .env (DATABASE_URL, SCHEDULER_SHARED_TOKEN,
 * TotalETO/PowerBI creds, etc.) — no need to duplicate secrets here.
 *
 * ── Port ───────────────────────────────────────────────────────────────────
 *   sdc-etc-planner   3010   (open inbound TCP in Windows Firewall for LAN)
 */

module.exports = {
  apps: [
    {
      name:          'sdc-etc-planner',
      // `next start` — serves the production build in .next. Invoke the Next
      // CLI directly so PM2 manages a single node process (no npm shim).
      script:        'node_modules/next/dist/bin/next',
      args:          'start -p 3010',
      interpreter:   'node',
      cwd:           'D:\\AI Projects\\sdc-etc-planner',
      env: {
        PORT:             '3010',
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
      },
      watch:         false,
      max_restarts:  10,
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },
  ],
};
