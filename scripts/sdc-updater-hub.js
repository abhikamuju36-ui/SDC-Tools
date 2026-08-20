'use strict';

/**
 * scripts/sdc-updater-hub.js — runs all 4 SDC auto-updaters in one PM2 process.
 *
 * Replaces 4 separate PM2 apps (sdc-updater, sdc-brr-updater,
 * sdc-scheduler-updater, sdc-statelogic-updater) with one. Each updater's own
 * file is unchanged in behavior — this just `require()`s them, which runs
 * their existing `main()` self-start and (for 3 of them) their existing
 * trigger HTTP server, exactly as when each ran standalone. Ports 4012/4013/
 * 4014 are unaffected; nothing outside this process needs to change.
 *
 * Why this is safe to merge: each updater's `checkAndUpdate()` already
 * wraps its real work in try/catch and never lets a routine failure (network
 * error, git conflict, build failure) escape as a rejected promise — it logs
 * and returns. The only way one updater could take down the others is a truly
 * unforeseen bug reaching the top-level `main().catch()` in that file; each of
 * those was changed to only `process.exit()` when run standalone
 * (`require.main === module`), so under this hub they just log instead.
 * The `unhandledRejection` handler below is a second safety net for anything
 * that still slips through — it logs and keeps the process (and the other
 * three updaters' schedules) alive rather than crashing everything.
 *
 * Run via PM2:  pm2 start ecosystem.config.js --only sdc-updater-hub
 */

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] [updater-hub] ${msg}`);
}

process.on('unhandledRejection', (err) => {
  log(`Caught an unhandled rejection from one of the updaters (process stays up): ${err && err.stack || err}`);
});

log('Starting all 4 updaters in one process...');

require('./sdc-main-updater.js');
require('../Build_Readiness_Report/scripts/sdc-brr-updater.js');
require('../SDC_Scheduler/scripts/server-auto-update.js');
require('../state_logic_builder/scripts/server-auto-update.js');

log('All 4 updaters started (assemblies/readiness/calendar/vendor monorepo, BRR, scheduler, statelogic).');
