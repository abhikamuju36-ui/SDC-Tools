'use strict';
// SDC Tools centralized session — shared verification, copied identically
// into each of the 4 apps that have no login of their own. Minted by
// SDC Scheduler (see its routes/ssoCentral.js) right after the shell's
// Azure AD login; verified here with the same shared secret. This file only
// verifies — it can't mint a session even if compromised, unlike
// Scheduler's own copy which also holds the mint function.
//
// SDC_SSO_ENABLED gates whether requireSdcSession actually blocks anything,
// mirroring the AUTH_ENABLED / SKIP_AUTH feature-flag convention already
// used elsewhere in the SDC Tools suite — lets this be deployed and tested
// before it's actually turned on in production.
const jwt = require('jsonwebtoken');

const SDC_SESSION_SECRET = process.env.SDC_SESSION_SECRET || '';
const SDC_SSO_ENABLED = process.env.SDC_SSO_ENABLED === 'true';

function verifySdcSession(token) {
  if (!SDC_SESSION_SECRET || !token) return null;
  try { return jwt.verify(token, SDC_SESSION_SECRET); }
  catch { return null; }
}

// appKey: this app's own key in the roles map minted by ssoCentral.js.
function requireSdcSession(appKey) {
  return function (req, res, next) {
    if (!SDC_SSO_ENABLED) return next(); // flag off — no behavior change yet

    const token = (req.cookies && req.cookies.sdc_session) || '';
    const claims = verifySdcSession(token);
    const allowed = claims && claims.apps && claims.apps[appKey];
    if (!allowed) {
      res.status(401);
      if ((req.headers.accept || '').includes('application/json')) {
        return res.json({ error: 'Please sign in via SDC Tools.', code: 'SDC_SESSION_REQUIRED' });
      }
      return res.type('html').send(
        '<!doctype html><html><head><meta charset="utf-8"><title>Sign in required</title>' +
        '<style>body{font-family:system-ui,sans-serif;background:#061D39;color:#fff;' +
        'display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
        '.card{text-align:center;padding:40px}h2{color:#FFDE51}p{color:#AACEE8}</style></head>' +
        '<body><div class="card"><h2>Sign in required</h2>' +
        '<p>Open SDC Tools and sign in — this app is part of that suite.</p></div></body></html>'
      );
    }
    req.sdcUser = { email: claims.email, name: claims.name, role: claims.apps[appKey] };
    next();
  };
}

module.exports = { requireSdcSession, verifySdcSession, SDC_SSO_ENABLED };
