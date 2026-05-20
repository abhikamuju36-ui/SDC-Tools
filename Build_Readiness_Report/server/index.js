require('dotenv').config();
const express = require('express');
const path = require('path');

const bomRoutes       = require('./routes/bom');
const readinessRoutes = require('./routes/readiness');
const emailRoutes     = require('./routes/emails');
const checkRoutes     = require('./routes/check');

const app  = express();
const PORT = process.env.PORT || 3000;

// Security headers
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options':  'nosniff',
    'X-Frame-Options':         'DENY',
    'X-XSS-Protection':        '0',
    'Referrer-Policy':         'strict-origin-when-cross-origin',
  });
  next();
});

app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'client')));

// API routes
app.use('/api/check',     checkRoutes);
app.use('/api/bom',       bomRoutes);
app.use('/api/readiness', readinessRoutes);
app.use('/api/emails',    emailRoutes);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status < 500 ? err.message : 'Internal server error' });
});

function startServer({ port } = {}) {
  const p = port || PORT;
  const server = app.listen(p, '0.0.0.0', () => {
    console.log(`[readiness] Running at http://localhost:${p}`);
  });
  server.on('error', err => console.error('[readiness] Server error:', err.message));
  return server;
}

if (require.main === module) startServer();
module.exports = { startServer };

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
