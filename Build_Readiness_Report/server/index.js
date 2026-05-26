require('dotenv').config();
const express = require('express');
const path = require('path');

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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'client')));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, service: 'readiness', uptime: process.uptime() }));

app.use('/api/check', checkRoutes);
app.use('/api/bom', bomRoutes);
app.use('/api/readiness', readinessRoutes);
app.use('/api/emails', emailRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
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
