require('dotenv').config();

const express = require('express');
const session = require('express-session');
const corsMiddleware = require('cors');
const path    = require('path');
const logger  = require('./logger');

// Initialise Azure SQL schema on startup (idempotent — safe to run every boot)
const { ensureSchema } = require('./azureDb');
ensureSchema()
  .then(() => logger.info('[DB] Azure SQL schema ready.'))
  .catch(err => logger.error('[DB] Schema init failed — check AZURE_SQL_* env vars:', err.message));
const authRouter        = require('./auth');
const adminRouter       = require('./routes/admin');
const schedulerRouter       = require('./routes/scheduler');
const eventsRouter          = require('./routes/events');
const notificationsRouter   = require('./routes/notifications');
const NotificationService = require('./notificationService');

NotificationService.start();

const app      = express();
const API_PORT = process.env.PORT        || 3001;
const STATIC_DIR = path.join(__dirname, '..', 'frontend');

// ── Middleware ────────────────────────────────────────────
// ALLOWED_ORIGINS: comma-separated list in .env for production deployments
// e.g. ALLOWED_ORIGINS=http://calendar.sdcautomation.com,https://calendar.sdcautomation.com
const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);
const CORS_ORIGINS = [
  ...EXTRA_ORIGINS,
  `http://localhost:${API_PORT}`,
];
app.use(corsMiddleware({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
}));

app.use(express.json());

// Winston HTTP Logging Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms [IP: ${req.ip}]`);
  });
  next();
});

// Sessions are only needed for Azure OAuth flow; skip when running via the shell (SKIP_AUTH=true)
if (process.env.SKIP_AUTH !== 'true') {
  app.use(session({
    secret:            process.env.SESSION_SECRET || 'sdc-session-fallback',
    resave:            false,
    saveUninitialized: false,
    cookie:            { secure: false, maxAge: 8 * 60 * 60 * 1000 },
  }));
}

// ── API Routes ────────────────────────────────────────────
app.use('/auth',             authRouter);
app.use('/api/admin',        adminRouter);
app.use('/api/scheduler',      schedulerRouter);
app.use('/api/events',         eventsRouter);
app.use('/api/notifications',  notificationsRouter);
app.get('/health',     (_req, res) => res.json({ status: 'ok', service: 'calendar', uptime: process.uptime() }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Serve static calendar files ───────────────────────────
app.use(express.static(STATIC_DIR));
// Catch-all: serve the calendar HTML for any unknown path
app.get('*', (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// ── Exportable entry point (used by Electron in-process execution) ────────────
function startServer({ port } = {}) {
  const p = port || API_PORT;
  const server = app.listen(p, '0.0.0.0', () => {
    logger.info(`[calendar] Running at http://localhost:${p}`);
  });
  server.on('error', (err) => {
    logger.error(`[calendar] Server error on port ${p}: ${err.message}`);
  });
  process.on('SIGTERM', () => {
    logger.info('[calendar] SIGTERM — shutting down gracefully');
    server.close(() => process.exit(0));
  });
  return server;
}

if (require.main === module) startServer();
module.exports = { startServer };
