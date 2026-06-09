require('dotenv').config();
const express = require('express');
const jwt     = require('jsonwebtoken');
const db      = require('./db');

const router = express.Router();

const REDIRECT_URI = `http://${process.env.SERVER_IP}:${process.env.PORT || 3001}/auth/callback`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const JWT_SECRET   = process.env.JWT_SECRET;
const SCOPES       = ['User.Read'];

// Only initialise MSAL when all Azure AD credentials are present AND the package is installed.
// In shell mode (SKIP_AUTH=true) this block is never reached.
const AZURE_READY = !!(process.env.CLIENT_ID && process.env.TENANT_ID && process.env.CLIENT_SECRET);
let pca = null;
if (AZURE_READY) {
  try {
    const msal = require('@azure/msal-node');
    pca = new msal.ConfidentialClientApplication({
      auth: {
        clientId:     process.env.CLIENT_ID,
        authority:    `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
        clientSecret: process.env.CLIENT_SECRET,
      },
      system: { loggerOptions: { loggerCallback: () => {}, piiLoggingEnabled: false } },
    });
  } catch {
    console.warn('[auth] @azure/msal-node not installed — Azure AD login disabled.');
  }
}

// Step 1 — redirect to Microsoft login
router.get('/login', async (_req, res) => {
  if (!AZURE_READY) return res.status(503).send('Azure AD credentials not configured in .env');
  try {
    const url = await pca.getAuthCodeUrl({ scopes: SCOPES, redirectUri: REDIRECT_URI });
    res.redirect(url);
  } catch (err) {
    console.error('Auth URL error:', err);
    res.status(500).send('Failed to start login');
  }
});

// Step 2 — Microsoft returns auth code here
router.get('/callback', async (req, res) => {
  if (!AZURE_READY) return res.status(503).send('Azure AD credentials not configured in .env');
  if (req.query.error) {
    console.error('Azure error:', req.query.error, req.query.error_description);
    const msg = encodeURIComponent(req.query.error_description || req.query.error || 'auth_failed');
    return res.redirect(`${FRONTEND_URL}/SDC%20Centralized%20Calendar.html#error=${msg}`);
  }
  try {
    const tokenResp = await pca.acquireTokenByCode({
      code: req.query.code, scopes: SCOPES, redirectUri: REDIRECT_URI,
    });

    const email = tokenResp.account.username.toLowerCase();
    const name  = tokenResp.account.name || email;

    // Create or update user in DB
    const user = await db.users.upsert(email, name);
    // After upsert, fetch fresh doc so we have the role
    const fresh = await db.users.findByEmail(email);

    const token = jwt.sign(
      { id: fresh._id, email: fresh.email, name: fresh.name, role: fresh.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.redirect(`${FRONTEND_URL}/SDC%20Centralized%20Calendar.html#token=${token}`);
  } catch (err) {
    console.error('Callback error:', err.message || err);
    const msg = encodeURIComponent(err.message || 'auth_failed');
    res.redirect(`${FRONTEND_URL}/SDC%20Centralized%20Calendar.html#error=${msg}`);
  }
});

// GET /auth/me
router.get('/me', async (req, res) => {
  if (process.env.SKIP_AUTH === 'true') {
    return res.json({
      id:                'shell-sso-user',
      email:             process.env.SHELL_USER_EMAIL || 'sdc@sdcautomation.com',
      name:              process.env.SHELL_USER_NAME  || 'SDC User',
      role:              'admin',
      allowedCategories: ['holiday','payday','birthday','meeting','company','deadline','personal','vacation'],
    });
  }

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  let decoded;
  try { decoded = jwt.verify(auth.slice(7), JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Invalid token' }); }

  const user = await db.users.findById(decoded.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const roleDoc = await db.roles.findByRole(user.role);
  const allowedCategories = roleDoc?.categories || ['holiday', 'company'];

  res.json({ id: user._id, email: user.email, name: user.name, role: user.role, allowedCategories });
});

// POST /auth/logout
router.post('/logout', (_req, res) => res.json({ success: true }));

module.exports = router;
