'use strict';

/**
 * Build_Readiness_Report/scripts/sdc-brr-updater.js
 *
 * Polls abhikamuju36-ui/Build_Readiness_Report for new commits every 2 min.
 * On change: downloads tarball, replaces safe dirs/files, merges deps,
 * then pm2 restarts sdc-readiness.
 *
 * Preserved (never overwritten):
 *   server/index.js   — health endpoint, startServer() export, SDC additions
 *   server/cache/     — local JSON cache (job-specific data)
 *   .env
 *
 * Run via PM2:  pm2 start ecosystem.config.js --only sdc-brr-updater
 */

const https            = require('https');
const http             = require('http');
const fs               = require('fs');
const path             = require('path');
const os               = require('os');
const { execSync }     = require('child_process');

const GITHUB_REPO       = 'abhikamuju36-ui/Build_Readiness_Report';
const GITHUB_BRANCH     = 'main';
const CHECK_INTERVAL_MS = 2 * 60 * 1000;
const APP_DIR           = path.join(__dirname, '..');
const PM2_APP_NAME      = 'sdc-readiness';
const SHA_FILE          = path.join(APP_DIR, '.update-sha');

// Directories to wholesale replace from upstream
const SAFE_DIRS = [
  'client',
  path.join('server', 'routes'),
  path.join('server', 'services'),
  path.join('server', 'lib'),
  'tests',
];

// Individual root-level files to replace
const SAFE_FILES = ['.gitignore', 'START_APP.bat', 'ARROW_ROUTING_RULES.md'];

// ─── helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] [brr-updater] ${msg}`);
}

function getStoredSha() {
  try { return fs.readFileSync(SHA_FILE, 'utf8').trim(); } catch { return null; }
}

function storeSha(sha) {
  fs.writeFileSync(SHA_FILE, sha, 'utf8');
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, {
      headers: {
        'User-Agent': 'SDC-Tools-BRR-Updater/1.0',
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

function fetchJsonWithRetry(url, retries = 3, delayMs = 10000) {
  return fetchJson(url).catch(err => {
    if (retries <= 0) throw err;
    log(`Network error (${err.message}) — retrying in ${delayMs / 1000}s… (${retries} left)`);
    return new Promise(res => setTimeout(res, delayMs))
      .then(() => fetchJsonWithRetry(url, retries - 1, delayMs));
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const doGet = (u) => {
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, { headers: { 'User-Agent': 'SDC-Tools-BRR-Updater/1.0' } }, (res) => {
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

function run(cmd, cwd) {
  execSync(cmd, { cwd: cwd || APP_DIR, stdio: 'pipe' });
}

// ─── update flow ─────────────────────────────────────────────────────────────

async function checkAndUpdate() {
  const storedSha = getStoredSha();
  log(`Checking for updates… (stored SHA: ${storedSha ? storedSha.slice(0, 7) : 'none'})`);

  let remoteSha;
  try {
    const data = await fetchJsonWithRetry(
      `https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`
    );
    remoteSha = data.sha;
  } catch (e) {
    log(`GitHub API error: ${e.message}`);
    return;
  }

  if (!remoteSha) { log('Could not read remote SHA.'); return; }
  log(`Remote SHA: ${remoteSha.slice(0, 7)}`);

  // First run — store SHA without updating to avoid re-applying manual changes
  if (!storedSha) {
    log('First run — storing current SHA, no update needed.');
    storeSha(remoteSha);
    return;
  }

  if (storedSha === remoteSha) {
    log('Already up to date.');
    return;
  }

  log(`Update available (${storedSha.slice(0, 7)} → ${remoteSha.slice(0, 7)}). Downloading…`);

  const tmpTar = path.join(os.tmpdir(), `sdc-brr-${remoteSha.slice(0, 7)}.tar.gz`);
  const tmpDir = path.join(os.tmpdir(), `sdc-brr-extract-${Date.now()}`);

  try {
    // 1. Download tarball of latest commit
    const tarUrl = `https://api.github.com/repos/${GITHUB_REPO}/tarball/${GITHUB_BRANCH}`;
    await downloadFile(tarUrl, tmpTar);
    log('Downloaded. Extracting…');

    fs.mkdirSync(tmpDir, { recursive: true });
    run(`tar -xzf "${tmpTar}" -C "${tmpDir}" --strip-components=1`);

    // 2. Replace safe directories
    for (const dir of SAFE_DIRS) {
      const src = path.join(tmpDir, dir);
      const dst = path.join(APP_DIR, dir);
      if (!fs.existsSync(src)) continue;
      if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
      fs.cpSync(src, dst, { recursive: true, force: true });
      log(`  Replaced: ${dir}/`);
    }

    // 3. Replace safe individual files
    for (const file of SAFE_FILES) {
      const src = path.join(tmpDir, file);
      const dst = path.join(APP_DIR, file);
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, dst);
      log(`  Replaced: ${file}`);
    }

    // 4. Merge deps from upstream package.json (add new, skip removing existing)
    const upstreamPkgPath = path.join(tmpDir, 'package.json');
    if (fs.existsSync(upstreamPkgPath)) {
      const upstream = JSON.parse(fs.readFileSync(upstreamPkgPath, 'utf8'));
      const local    = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
      let depsChanged = false;
      for (const key of ['dependencies', 'devDependencies']) {
        for (const [pkg, ver] of Object.entries(upstream[key] || {})) {
          if (local[key]?.[pkg] !== ver) {
            local[key] = local[key] || {};
            local[key][pkg] = ver;
            depsChanged = true;
          }
        }
      }
      if (depsChanged) {
        fs.writeFileSync(path.join(APP_DIR, 'package.json'), JSON.stringify(local, null, 2));
        log('New dependencies detected — running npm install…');
        run('npm install');
      }
    }

    // 5. Rebuild Vite client bundle so dist/ is available for production serving.
    //    The updater wipes and replaces client/ from the tarball (which has no
    //    dist/ since it's gitignored). Without this step the server falls back
    //    to CDN mode because hasDistBuild=false.
    const clientPkgPath = path.join(APP_DIR, 'client', 'package.json');
    if (fs.existsSync(clientPkgPath)) {
      log('Building Vite client bundle…');
      try {
        run('npm ci --prefer-offline', path.join(APP_DIR, 'client'));
        run('npm run build', path.join(APP_DIR, 'client'));
        log('Client build complete — dist/ ready.');
      } catch (buildErr) {
        log(`Client build failed: ${buildErr.message} — server will fall back to CDN mode.`);
      }
    }

    // 6. Restart PM2 app
    log(`Restarting ${PM2_APP_NAME}…`);
    try { run(`pm2 restart ${PM2_APP_NAME} --update-env`); }
    catch (e) { log(`pm2 restart warning: ${e.message}`); }

    storeSha(remoteSha);
    log(`Successfully updated to ${remoteSha.slice(0, 7)}!`);

  } catch (e) {
    log(`Update failed: ${e.message}`);
    if (e.stack) log(e.stack.split('\n').slice(1, 3).join(' '));
  } finally {
    try { fs.unlinkSync(tmpTar); }                              catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ─── entry point ─────────────────────────────────────────────────────────────

async function main() {
  log('SDC Build Readiness Report — server auto-updater started');
  log(`Watching: https://github.com/${GITHUB_REPO}/tree/${GITHUB_BRANCH}`);
  log(`Check interval: ${CHECK_INTERVAL_MS / 60000} min`);
  await checkAndUpdate();
  setInterval(checkAndUpdate, CHECK_INTERVAL_MS);
}

main().catch(e => { log(`Fatal: ${e.message}`); process.exit(1); });

// ─── manual trigger server ────────────────────────────────────────────────────
// POST http://<host>:4012/trigger  →  runs checkAndUpdate() immediately
const TRIGGER_PORT = 4012;
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/trigger') {
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    checkAndUpdate().catch(e => log(`Manual trigger error: ${e.message}`));
  } else {
    res.writeHead(404); res.end();
  }
}).listen(TRIGGER_PORT, '0.0.0.0', () => log(`Trigger server on port ${TRIGGER_PORT}`));
