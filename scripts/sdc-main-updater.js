'use strict';

/**
 * scripts/sdc-main-updater.js — SDC Tools monorepo server updater
 *
 * Every CHECK_INTERVAL_MS it:
 *   1. Fetches the latest commit SHA on master from GitHub API
 *   2. Compares with the local git HEAD
 *   3. If remote is ahead:
 *        a. git fetch origin
 *        b. Diff changed files between local HEAD and remote
 *        c. Selectively checkout only files this updater owns
 *           (skips paths managed by sdc-scheduler-updater / sdc-statelogic-updater)
 *        d. git reset --soft origin/master  — advances HEAD, leaves per-app dirs intact
 *        e. npm install  (only if package.json changed)
 *        f. Build Assemblies Library frontend  (only if its files changed)
 *        g. pm2 restart sdc-assemblies sdc-readiness sdc-calendar sdc-vendor
 *
 * Protected paths — never overwritten (managed by per-app updaters):
 *   SDC_Scheduler/public/, db.js, .gitignore, ARROW_ROUTING_RULES.md
 *     → managed by sdc-scheduler-updater  (danbelliveau2/SDC_Scheduler)
 *   state_logic_builder/src/, public/, index.html
 *     → managed by sdc-statelogic-updater (danbelliveau2/state_logic_builder)
 *
 * Run via PM2:
 *   pm2 start ecosystem.config.js --only sdc-updater
 */

const https        = require('https');
const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

const GITHUB_OWNER      = 'abhikamuju36-ui';
const GITHUB_REPO       = 'SDC-Tools';
const GITHUB_BRANCH     = 'master';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes
const REPO_DIR          = path.join(__dirname, '..');

// Paths managed by per-app updaters — never overwrite these from the monorepo git tree.
// Each entry is a prefix; any changed file whose path starts with a prefix is skipped.
const PROTECTED = [
  'SDC_Scheduler/public/',
  'SDC_Scheduler/db.js',
  'SDC_Scheduler/.gitignore',
  'SDC_Scheduler/ARROW_ROUTING_RULES.md',
  'state_logic_builder/src/',
  'state_logic_builder/public/',
  'state_logic_builder/index.html',
];

// ─── helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] [sdc-updater] ${msg}`);
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: REPO_DIR, stdio: 'pipe', ...opts }).toString().trim();
}

function getLocalHead() {
  try { return run('git rev-parse HEAD'); }
  catch { return null; }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'SDC-Tools-MainUpdater/2.0',
        'Accept':     'application/vnd.github.v3+json',
      },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302)
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse failed: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function isProtected(file) {
  return PROTECTED.some(p => file === p || file.startsWith(p));
}

// ─── update flow ─────────────────────────────────────────────────────────────

let isUpdating = false;

async function checkAndUpdate() {
  if (isUpdating) return;

  const localSha = getLocalHead();
  log(`Checking for updates… (local HEAD: ${localSha ? localSha.slice(0, 7) : 'unknown'})`);

  let remoteSha;
  try {
    const data = await fetchJson(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`
    );
    remoteSha = data.sha;
  } catch (e) {
    log(`GitHub API error: ${e.message}`);
    return;
  }

  if (!remoteSha) { log('Could not read remote SHA.'); return; }
  log(`Remote HEAD: ${remoteSha.slice(0, 7)}`);

  if (localSha === remoteSha) { log('Already up to date.'); return; }

  log(`Updates available (${localSha ? localSha.slice(0, 7) : '?'} → ${remoteSha.slice(0, 7)}). Pulling selectively…`);
  isUpdating = true;

  try {
    // 1. Fetch latest refs from remote
    run('git fetch origin');

    // 2. List all files that changed between local HEAD and remote
    let changedFiles = [];
    try {
      const diffOut = run(`git diff --name-only HEAD origin/${GITHUB_BRANCH}`);
      changedFiles = diffOut.split('\n').map(f => f.trim()).filter(Boolean);
    } catch {
      log('Could not diff against HEAD — treating as full monorepo update.');
    }

    // 3. Split into monorepo-owned vs per-app-updater-owned
    const monorepoFiles = changedFiles.filter(f => !isProtected(f));
    const skippedCount  = changedFiles.length - monorepoFiles.length;
    if (skippedCount > 0) {
      log(`Skipping ${skippedCount} file(s) in per-app-updater dirs (scheduler/statelogic).`);
    }

    // 4. Selectively checkout only monorepo-owned files from remote
    let checkedOut = 0;
    for (const file of monorepoFiles) {
      try {
        run(`git checkout origin/${GITHUB_BRANCH} -- "${file}"`);
        checkedOut++;
      } catch {
        // File was deleted in remote — remove locally
        try {
          fs.unlinkSync(path.join(REPO_DIR, file));
          log(`  Deleted: ${file}`);
        } catch { /* already gone */ }
      }
    }
    if (checkedOut > 0) log(`Checked out ${checkedOut} monorepo file(s).`);

    // 5. Advance HEAD to remote SHA without touching working tree.
    //    Per-app-updater files in SDC_Scheduler/ and state_logic_builder/ are preserved as-is.
    run(`git reset --soft origin/${GITHUB_BRANCH}`);
    log(`HEAD → ${remoteSha.slice(0, 7)}`);

    // 6. Install deps only if package.json changed
    if (monorepoFiles.some(f => f === 'package.json' || f === 'package-lock.json')) {
      log('package.json changed — running npm install…');
      run('npm install');
    }

    // 7. Rebuild Assemblies Library frontend only if its sources changed
    const assembliesChanged = monorepoFiles.some(f => f.startsWith('Assembilies library main/'));
    if (assembliesChanged) {
      log('Assemblies Library changed — rebuilding frontend…');
      run('npm run build --prefix "Assembilies library main"');
    }

    // 8. Restart only the apps this updater owns.
    //    sdc-scheduler and sdc-statelogic have their own per-app updaters.
    log('Restarting owned apps (assemblies, readiness, calendar, vendor)…');
    execSync(
      'pm2 restart sdc-assemblies sdc-readiness sdc-calendar sdc-vendor --update-env',
      { cwd: REPO_DIR, stdio: 'inherit' }
    );

    // 9. Ensure sdc-scheduler-repo-sync is running (start if not yet registered).
    try {
      execSync('pm2 describe sdc-scheduler-repo-sync', { stdio: 'pipe' });
    } catch {
      log('Starting sdc-scheduler-repo-sync for the first time…');
      execSync(
        `pm2 start "${REPO_DIR}/ecosystem.config.js" --only sdc-scheduler-repo-sync`,
        { cwd: REPO_DIR, stdio: 'inherit' }
      );
      execSync('pm2 save --force', { cwd: REPO_DIR, stdio: 'pipe' });
    }

    const newHead = getLocalHead();
    log(`Deploy complete. Now at: ${newHead ? newHead.slice(0, 7) : 'unknown'}`);

  } catch (e) {
    log(`Update failed: ${e.message}`);
    if (e.stack) log(e.stack.split('\n').slice(1, 3).join(' '));
  } finally {
    isUpdating = false;
  }
}

// ─── entry point ─────────────────────────────────────────────────────────────

async function main() {
  log('SDC Tools monorepo server updater started (v2 — selective checkout)');
  log(`Watching: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/tree/${GITHUB_BRANCH}`);
  log(`Check interval: ${CHECK_INTERVAL_MS / 60000} min`);
  log('Owns: assemblies (4001)  readiness (4002)  calendar (4005)  vendor (4006)');
  log('Per-app updaters: sdc-scheduler-updater → 4003 | sdc-statelogic-updater → 4004');

  await checkAndUpdate();
  setInterval(checkAndUpdate, CHECK_INTERVAL_MS);
}

main().catch(e => { log(`Fatal: ${e.message}`); process.exit(1); });
