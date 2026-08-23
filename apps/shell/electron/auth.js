/**
 * Microsoft SSO authentication module (MSAL Node)
 * Restricts access to @sdcautomation.com accounts only.
 *
 * ── Azure AD Setup (one-time, requires IT admin) ──────────────────────────────
 * 1. Go to https://portal.azure.com → Azure Active Directory → App registrations
 * 2. Click "New registration"
 *    - Name: SDC Tools
 *    - Supported account types: "Accounts in this organizational directory only"
 *    - Redirect URI: select "Public client/native (mobile & desktop)" → http://localhost
 * 3. Click Register. Copy the "Application (client) ID" and "Directory (tenant) ID".
 * 4. Go to "Authentication" → under "Advanced settings" enable "Allow public client flows" → Save
 * 5. Paste the IDs into shell/.env:
 *      AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *      AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { PublicClientApplication, LogLevel } = require('@azure/msal-node');
const { shell, app }  = require('electron');
const path            = require('path');
const fs              = require('fs');

const TENANT_ID      = process.env.AZURE_TENANT_ID;
const CLIENT_ID      = process.env.AZURE_CLIENT_ID;
const ALLOWED_DOMAIN = 'sdcautomation.com';
const CACHE_PATH     = path.join(app.getPath('userData'), 'sdc-auth-cache.json');

// ── Token cache persistence ───────────────────────────────────────────────────
// Saves tokens to disk so employees stay logged in across app restarts.
const cachePlugin = {
  beforeCacheAccess: async (ctx) => {
    try { ctx.tokenCache.deserialize(fs.readFileSync(CACHE_PATH, 'utf8')); } catch (_) {}
  },
  afterCacheAccess: async (ctx) => {
    if (ctx.cacheHasChanged) {
      try { fs.writeFileSync(CACHE_PATH, ctx.tokenCache.serialize(), 'utf8'); } catch (_) {}
    }
  },
};

let _pca = null;

function _getPCA() {
  if (!_pca) {
    _pca = new PublicClientApplication({
      auth: {
        clientId:  CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      },
      cache: { cachePlugin },
      system: {
        loggerOptions: {
          loggerCallback: (level, msg) => { if (level === LogLevel.Error) console.error('[MSAL]', msg); },
          logLevel: LogLevel.Error,
        },
      },
    });
  }
  return _pca;
}

async function _getSDCAccount() {
  const accounts = await _getPCA().getTokenCache().getAllAccounts();
  return accounts.find(a => a.username?.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) || null;
}

// ── Public API ────────────────────────────────────────────────────────────────

async function getAuthStatus() {
  if (!TENANT_ID || !CLIENT_ID ||
      TENANT_ID === 'YOUR_TENANT_ID_HERE' || CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
    return { isAuthenticated: false, user: null, configured: false };
  }
  try {
    const account = await _getSDCAccount();
    if (!account) return { isAuthenticated: false, user: null, configured: true };
    // Silent refresh validates the cached token is still accepted by Azure AD
    const result = await _getPCA().acquireTokenSilent({
      account,
      scopes: ['openid', 'profile', 'email'],
    });
    return {
      isAuthenticated: true,
      configured: true,
      user: { name: account.name, email: account.username },
      // Needed by sdcSession.js to (re-)establish the cross-app session on
      // startup without prompting a fresh interactive login — see main.js's
      // app.whenReady(). Not persisted anywhere by this module; the caller
      // uses it once and discards it.
      idToken: result.idToken,
    };
  } catch {
    return { isAuthenticated: false, user: null, configured: true };
  }
}

async function login() {
  if (!TENANT_ID || !CLIENT_ID ||
      TENANT_ID === 'YOUR_TENANT_ID_HERE' || CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
    return {
      success: false,
      error: 'Azure AD is not configured yet. Add AZURE_TENANT_ID and AZURE_CLIENT_ID to shell/.env',
    };
  }
  try {
    const result = await _getPCA().acquireTokenInteractive({
      scopes: ['openid', 'profile', 'email'],
      openBrowser: async (url) => { await shell.openExternal(url); },
      successTemplate: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: 'Segoe UI', sans-serif; background: #061D39; color: #fff;
               display: flex; align-items: center; justify-content: center; height: 100vh; }
        .card { text-align: center; padding: 40px; }
        .check { font-size: 48px; color: #FFDE51; margin-bottom: 16px; }
        h2 { color: #FFDE51; font-size: 22px; margin-bottom: 8px; }
        p  { color: #AACEE8; font-size: 14px; }
      </style></head><body><div class="card">
        <div class="check">&#10003;</div>
        <h2>Signed in successfully</h2>
        <p>Return to SDC Tools — you can close this window.</p>
      </div></body></html>`,
      errorTemplate: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { font-family: 'Segoe UI', sans-serif; background: #061D39; color: #fca5a5;
               display: flex; align-items: center; justify-content: center; height: 100vh; }
      </style></head><body><h2 style="text-align:center">Sign-in failed: {error}</h2></body></html>`,
    });

    const email = result.account?.username?.toLowerCase() || '';
    if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      await _getPCA().getTokenCache().removeAccount(result.account);
      return {
        success: false,
        error: `Access is restricted to @${ALLOWED_DOMAIN} accounts.\n"${email}" is not an SDC employee account.`,
      };
    }

    return {
      success: true,
      user: { name: result.account.name, email: result.account.username },
      // See getAuthStatus()'s matching comment — same reason, first-login case.
      idToken: result.idToken,
    };
  } catch (err) {
    if (err.errorCode === 'user_cancelled' || err.message?.includes('user_cancelled')) {
      return { success: false, error: 'Sign-in was cancelled.' };
    }
    return { success: false, error: err.message || 'Authentication failed.' };
  }
}

async function logout() {
  try {
    const account = await _getSDCAccount();
    if (account) await _getPCA().getTokenCache().removeAccount(account);
    _pca = null;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { getAuthStatus, login, logout };
