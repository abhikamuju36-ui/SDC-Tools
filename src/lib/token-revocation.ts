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
const _cache = new Map<number, { version: number; expiresAt: number }>();
const CACHE_MS = 60_000;

// Null means "no such user" — callers should treat that the same as an
// invalidated session, not as "version 0, carry on".
export async function currentTokenVersion(userId: number): Promise<number | null> {
  const now = Date.now();
  const cached = _cache.get(userId);
  if (cached && cached.expiresAt > now) return cached.version;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
  if (!user) return null;
  _cache.set(userId, { version: user.tokenVersion, expiresAt: now + CACHE_MS });
  return user.tokenVersion;
}

export function invalidateTokenVersionCache(userId: number): void {
  _cache.delete(userId);
}
