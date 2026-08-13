import "server-only";
import { prisma } from "@/lib/prisma";

// Lets "sign out" actually stop a session from working — on a plain
// password-based one AND one established via the Scheduler SSO hand-off.
// NextAuth's JWT strategy is stateless by default, so without this, sign-out
// only ever meant "the browser forgot its own cookie"; a captured/replayed
// token, or a session left open on another device, would keep working for
// the rest of its natural life regardless.
//
// A per-user counter, embedded in the JWT at sign-in and re-checked against
// the current DB value on every request (auth.ts's `jwt` callback) —
// bumping it makes every previously-issued token for that user stop being
// honoured, without touching how sign-IN itself works for anyone else or
// for that user's next sign-in.
//
// Cached briefly so the re-check doesn't cost a query on every single page
// load — same rationale, and the same ~60s ceiling, as the Scheduler's own
// `_activeCache` for its account-disabled check (server.js). Bumping a
// user's version also clears their cache entry immediately, so within THIS
// process a revoke takes effect right away rather than waiting out the
// window; the 60s figure is only the worst case (e.g. across a restart, or
// if a future deploy ever runs more than one instance).
const _cache = new Map<number, { version: number; active: boolean; expiresAt: number }>();
const CACHE_MS = 60_000;

// `active` exists in the database (see prisma/migrations/20260813010000_add_user_active)
// but isn't in the generated Prisma Client's types yet — `prisma generate` is blocked on
// this box by a locked query-engine DLL, the same constraint documented in
// employee-team-field.ts. Raw SQL is the established fallback; tokenVersion is read the
// same way here (rather than split across a typed query and a raw one) so this stays one
// round trip. Once `generate` succeeds again this can go back to `prisma.user.findUnique`.
async function fetchVersionAndActive(userId: number): Promise<{ version: number; active: boolean } | null> {
  const rows = await prisma.$queryRaw<{ tokenVersion: number; active: number | boolean }[]>`
    SELECT tokenVersion, active FROM User WHERE id = ${userId}
  `;
  const row = rows[0];
  return row ? { version: row.tokenVersion, active: Boolean(row.active) } : null;
}

// Null means "no such user" OR "deactivated" — callers (both auth.ts authorize()
// functions, and its jwt callback's re-check) treat either the same as an invalidated
// session, not as "version 0, carry on". A deactivated user is never handed a version
// number at all; there is nothing for a later reactivation to accidentally match against.
export async function currentTokenVersion(userId: number): Promise<number | null> {
  const now = Date.now();
  const cached = _cache.get(userId);
  if (cached && cached.expiresAt > now) return cached.active ? cached.version : null;

  const row = await fetchVersionAndActive(userId);
  if (!row) return null;
  _cache.set(userId, { version: row.version, active: row.active, expiresAt: now + CACHE_MS });
  return row.active ? row.version : null;
}

export function invalidateTokenVersionCache(userId: number): void {
  _cache.delete(userId);
}
