require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

// ── Env validation — warn if ETO vars missing in live mode ──────────────────
if (process.env.ETO_HOST && process.env.ETO_HOST !== 'your-server-here') {
  const missing = ['ETO_DATABASE', 'ETO_USER', 'ETO_PASSWORD'].filter(v => !process.env[v]);
  if (missing.length) {
    console.error(`[readiness] FATAL — ETO_HOST is set but missing: ${missing.join(', ')}`);
    console.error('[readiness] Check ecosystem.config.js or .env and restart.');
    process.exit(1);
  }
}

const bomRoutes = require('./routes/bom');
const readinessRoutes = require('./routes/readiness');
const emailRoutes = require('./routes/emails');
const checkRoutes = require('./routes/check');
const { requireSdcSession } = require('./sdcSessionAuth');

const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cookieParser());

app.get('/health', (_req, res) => res.json({ ok: true, service: 'readiness', uptime: process.uptime() }));

// SDC Tools centralized session — requires the shared "sdc_session" cookie
// (minted by SDC Scheduler's central SSO after Azure AD login) on everything
// below this line. No-op until SDC_SSO_ENABLED=true — see server/sdcSessionAuth.js.
app.use(requireSdcSession('readiness'));

// ── Static file strategy ─────────────────────────────────────────────────────
// Prefer the Vite production build (client/dist/) when it exists — it is a
// self-contained bundle with hashed assets and no CDN dependency.
// Fall back to the raw client/ folder (CDN + Babel mode) when dist/ is absent
// — this keeps the app alive even if the auto-updater pulls a clean checkout
// that doesn't include the pre-built dist/.
const distDir   = path.join(__dirname, '..', 'client', 'dist');
const clientDir = path.join(__dirname, '..', 'client');
const hasDistBuild = fs.existsSync(path.join(distDir, 'index.html'));
const staticDir = hasDistBuild ? distDir : clientDir;

console.log(`[readiness] Serving frontend from: ${staticDir}`);

// Shared design tokens live outside this app, in packages/design-system. They
// are mounted over HTTP rather than CSS-@imported so they resolve in BOTH
// serving modes above - a relative @import would only be inlined by the Vite
// build, and would 404 in the raw-client/ fallback, stripping every token.
app.use('/design-system', express.static(
  path.join(__dirname, '..', '..', '..', 'packages', 'design-system')
));

app.use(express.static(staticDir));
app.use(express.json());

app.use('/api/check', checkRoutes);
app.use('/api/bom', bomRoutes);
app.use('/api/readiness', readinessRoutes);
app.use('/api/emails', emailRoutes);

// Unmatched /api/* — return JSON 404 so callers get a structured error instead
// of silently receiving the SPA HTML (which is what the catch-all below sends).
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `No API route: ${req.method} ${req.path}` });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

function startServer({ port } = {}) {
  const p = port || PORT;
  const server = app.listen(p, '0.0.0.0', () => {
    console.log(`SDC Build Readiness Report running at http://localhost:${p}`);
  });
  server.on('error', err => console.error('[readiness] Server error:', err.message));
  process.on('SIGTERM', () => {
    console.log('[readiness] SIGTERM — shutting down gracefully');
    server.close(() => process.exit(0));
  });
  return server;
}

if (require.main === module) startServer();
module.exports = { startServer };
