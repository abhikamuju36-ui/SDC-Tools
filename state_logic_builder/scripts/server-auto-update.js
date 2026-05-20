/**
 * server-auto-update.js
 *
 * Mirrors what electron-updater does for the desktop app, but for the
 * PM2-hosted web server edition.
 *
 * Every CHECK_INTERVAL_MS it:
 *   1. Calls GitHub API to get the latest release of danbelliveau2/state_logic_builder
 *   2. Compares tag with the version in ./package.json
 *   3. If newer: downloads the source tarball, replaces src/ + public/ + index.html,
 *      runs npm install (if package.json changed), npm run build, pm2 restart statelogic
 *
 * Only src/, public/, and index.html are overwritten — server.js, azureDb.js,
 * .env, vite.config.js, and user data (projects/, standards/) are preserved.
 *
 * Run via PM2:  pm2 start ecosystem.config.js --only statelogic-updater
 */

'use strict';

const https    = require('https');
const http     = require('http');
const fs       = require('fs');
const fsp      = require('fs').promises;
const path     = require('path');
const os       = require('os');
const { execSync } = require('child_process');

const GITHUB_REPO       = 'danbelliveau2/state_logic_builder';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes — same cadence as electron-updater
const APP_DIR           = path.join(__dirname, '..');
const PM2_APP_NAME      = 'statelogic';

// Directories/files from upstream that are safe to replace
const SAFE_PATHS = ['src', 'public', 'index.html'];

// ─── helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] [statelogic-updater] ${msg}`);
}

function getCurrentVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, {
      headers: {
        'User-Agent': 'SDC-Tools-ServerUpdater/1.0',
        'Accept':     'application/vnd.github.v3+json',
      },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse failed: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const doGet = (u) => {
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, { headers: { 'User-Agent': 'SDC-Tools-ServerUpdater/1.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return doGet(res.headers.location);
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    };
    doGet(url);
  });
}

function newerThan(current, latest) {
  const parse = v => v.replace(/^v/, '').split('.').map(Number);
  const a = parse(current);
  const b = parse(latest);
  for (let i = 0; i < 3; i++) {
    if ((b[i] || 0) > (a[i] || 0)) return true;
    if ((b[i] || 0) < (a[i] || 0)) return false;
  }
  return false;
}

function cpDir(src, dst) {
  // Recursive copy, available Node 16.7+
  fs.cpSync(src, dst, { recursive: true, force: true });
}

function run(cmd, cwd) {
  execSync(cmd, { cwd: cwd || APP_DIR, stdio: 'pipe' });
}

// ─── main update flow ─────────────────────────────────────────────────────────

async function checkAndUpdate() {
  const current = getCurrentVersion();
  log(`Checking for updates… (current: v${current})`);

  let release;
  try {
    release = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
  } catch (e) {
    log(`GitHub API error: ${e.message}`);
    return;
  }

  if (!release || !release.tag_name) {
    log('No releases found on GitHub.');
    return;
  }

  const latest = release.tag_name;
  log(`Latest release: ${latest}`);

  if (!newerThan(current, latest)) {
    log('Already up to date.');
    return;
  }

  log(`Update available: v${current} → ${latest}  Downloading…`);

  const tmpTar = path.join(os.tmpdir(), `sdc-statelogic-${latest}.tar.gz`);
  const tmpDir = path.join(os.tmpdir(), `sdc-statelogic-extract-${Date.now()}`);

  try {
    // 1. Download source tarball
    await downloadFile(release.tarball_url, tmpTar);
    log('Downloaded. Extracting…');

    // 2. Extract (tar ships with Windows 10+)
    fs.mkdirSync(tmpDir, { recursive: true });
    run(`tar -xzf "${tmpTar}" -C "${tmpDir}" --strip-components=1`);

    // 3. Replace safe paths
    for (const p of SAFE_PATHS) {
      const src = path.join(tmpDir, p);
      const dst = path.join(APP_DIR, p);
      if (!fs.existsSync(src)) continue;

      if (fs.statSync(src).isDirectory()) {
        // Remove old, copy fresh
        if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
        cpDir(src, dst);
        log(`  Replaced: ${p}/`);
      } else {
        fs.copyFileSync(src, dst);
        log(`  Replaced: ${p}`);
      }
    }

    // 4. Check if upstream package.json has new deps
    const upstreamPkg = path.join(tmpDir, 'package.json');
    if (fs.existsSync(upstreamPkg)) {
      const upstream = JSON.parse(fs.readFileSync(upstreamPkg, 'utf8'));
      const local    = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
      const depKeys = ['dependencies', 'devDependencies'];
      let depsChanged = false;
      for (const key of depKeys) {
        const up = upstream[key] || {};
        const lo = local[key] || {};
        for (const [pkg, ver] of Object.entries(up)) {
          if (lo[pkg] !== ver) { depsChanged = true; break; }
        }
        if (depsChanged) break;
      }
      if (depsChanged) {
        log('New dependencies detected — running npm install…');
        // Merge only deps into local package.json (preserve server.js scripts + mssql)
        for (const key of depKeys) {
          if (upstream[key]) local[key] = { ...local[key], ...upstream[key] };
        }
        fs.writeFileSync(path.join(APP_DIR, 'package.json'), JSON.stringify(local, null, 2));
        run('npm install');
      }
    }

    // 5. Rebuild frontend
    log('Building frontend…');
    run('npm run build');

    // 6. Bump local version to match
    const localPkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
    localPkg.version = latest.replace(/^v/, '');
    fs.writeFileSync(path.join(APP_DIR, 'package.json'), JSON.stringify(localPkg, null, 2));

    // 7. Restart PM2 app
    log(`Restarting ${PM2_APP_NAME}…`);
    try { run(`pm2 restart ${PM2_APP_NAME} --update-env`); } catch (e) {
      log(`pm2 restart warning: ${e.message}`);
    }

    log(`Successfully updated to ${latest}!`);

  } catch (e) {
    log(`Update failed: ${e.message}`);
    if (e.stack) log(e.stack.split('\n').slice(1, 3).join(' '));
  } finally {
    try { fs.unlinkSync(tmpTar); }           catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ─── entry point ─────────────────────────────────────────────────────────────

async function main() {
  log(`SDC State Logic Builder — server auto-updater started`);
  log(`Watching: https://github.com/${GITHUB_REPO}/releases`);
  log(`Check interval: ${CHECK_INTERVAL_MS / 60000} min`);

  await checkAndUpdate();
  setInterval(checkAndUpdate, CHECK_INTERVAL_MS);
}

main().catch(e => { log(`Fatal: ${e.message}`); process.exit(1); });
