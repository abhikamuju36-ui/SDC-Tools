const jwt = require('jsonwebtoken');

// When the calendar runs inside the SDC shell, the shell handles SSO.
// SKIP_AUTH=true bypasses JWT and grants full admin access automatically.
const SHELL_USER = {
  id:                'shell-sso-user',
  email:             process.env.SHELL_USER_EMAIL || 'sdc@sdcautomation.com',
  name:              process.env.SHELL_USER_NAME  || 'SDC User',
  role:              'admin',
  allowedCategories: ['holiday','payday','birthday','meeting','company','deadline','personal','vacation'],
};

function requireAuth(req, res, next) {
  if (process.env.SKIP_AUTH === 'true') {
    req.user = SHELL_USER;
    return next();
  }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — no token provided' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden — admin access required' });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin };
