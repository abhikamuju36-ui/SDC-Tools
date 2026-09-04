const jwt = require('jsonwebtoken');
const db = require('../db');
const { verifySdcSession } = require('@sdc/shared-auth');

// ── SDC Tools centralized login (2026-08-20) ────────────────────────────────
//
// Real per-user identity, sourced from the shared `sdc_session` cookie the
// Electron shell sets right after its own Azure AD login (see
// SDC_Scheduler/routes/ssoCentral.js, which mints it, and the same
// verification shared via packages/shared-auth — this is the same check,
// not a fourth reinvention of it).
//
// Deliberately does NOT trust the token's `apps.calendar` value as the role.
// That claim is only a coarse "is calendar in this person's app map at all"
// gate (ssoCentral.js defaults it to 'employee' for anyone with no row yet,
// so it is truthy for every signed-in company account today) — the actual
// role stays owned by THIS app's own `users`/`roles` tables, exactly as
// before. Two reasons: it is the pre-existing, real, admin-editable source
// of truth (routes/admin.js), and it means a role change made here takes
// effect on the person's very next request, with no separate sync/backfill
// step to keep in step with a second copy of the same fact.

async function resolveShellUser(claims) {
  const email = String(claims.email || '').trim().toLowerCase();
  if (!email) return null;
  const name = claims.name || email;
  // upsert(): updates name/last_login for an existing person, or creates a
  // new one at the default 'employee' role — the identical "unknown = least
  // privilege" rule this app already applied to its old standalone OAuth
  // sign-in (see the now-removed dormant path this middleware replaces).
  const user = await db.users.upsert(email, name);
  const roleRow = await db.roles.findByRole(user.role);
  return {
    id: user._id,
    email: user.email,
    name: user.name,
    role: user.role,
    allowedCategories: roleRow ? roleRow.categories : [],
  };
}

// Legacy fallback for the standalone OAuth flow this app never actually
// deployed (see server/auth.js) — kept only so a `Bearer <JWT_SECRET token>`
// issued by that path, if one is ever produced, still verifies. Not the
// primary path for anyone opening this app through SDC Tools.
function verifyLegacyBearer(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try { return jwt.verify(auth.slice(7), process.env.JWT_SECRET); }
  catch { return null; }
}

function sendSignInRequired(req, res) {
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

async function requireAuth(req, res, next) {
  const sdcToken = req.cookies && req.cookies.sdc_session;
  const claims = verifySdcSession(sdcToken);
  if (claims && claims.apps && claims.apps.calendar) {
    try {
      const user = await resolveShellUser(claims);
      if (user) {
        req.user = user;
        return next();
      }
    } catch (e) {
      // A DB hiccup resolving the shell identity — fall through to the
      // legacy bearer check rather than surface a 500 for what is, from the
      // caller's side, a sign-in request.
    }
  }

  const legacy = verifyLegacyBearer(req);
  if (legacy) {
    req.user = legacy;
    return next();
  }

  return sendSignInRequired(req, res);
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden — admin access required' });
    }
    next();
  });
}

// Exported for /auth/me (server/auth.js) — same resolution, not a second copy.
async function resolveFromSdcSessionCookie(req) {
  const sdcToken = req.cookies && req.cookies.sdc_session;
  const claims = verifySdcSession(sdcToken);
  if (!claims || !claims.apps || !claims.apps.calendar) return null;
  return resolveShellUser(claims);
}

module.exports = { requireAuth, requireAdmin, resolveFromSdcSessionCookie };
