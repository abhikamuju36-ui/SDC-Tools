import "server-only";
import { fetchSchedulerProjectJobNumbers } from "./scheduler-db";
import { withSchedulerSso } from "./scheduler-sso";
import { auth } from "./auth";
import { withTimeoutOrNull } from "./with-timeout";

// Browser-reachable base URL of the SDC Scheduler app. The link is clicked in
// the user's browser, so it must use the LAN hostname (users reach ETC at
// server-app1:3010 and the Scheduler at server-app1:4003) — NOT localhost.
// Override with SCHEDULER_BASE_URL in .env if the host/port ever changes.
const DEFAULT_SCHEDULER_BASE_URL = "http://server-app1:4003";

export function getSchedulerBaseUrl(): string {
  return (process.env.SCHEDULER_BASE_URL || DEFAULT_SCHEDULER_BASE_URL).replace(/\/+$/, "");
}

// The Scheduler SPA reads ?job=<etcJobId>&view=schedule on boot, resolves the
// project whose projects.job_number matches, opens it, and switches to the
// schedule view (see SDC_Scheduler public/app.js init()).
// `ssoEmail` — when given, the link carries a 60-second signed assertion of who
// is signed in to ETC, so the Scheduler starts its own session instead of
// stopping at a login modal. A fresh token per link, deliberately: the assertion
// carries a single-use nonce, so one shared token would let the FIRST icon
// clicked work and the next one fall back to the modal. Minting is an HMAC over
// ~60 bytes — cheap enough to do per row.
export function schedulerScheduleUrl(baseUrl: string, jobId: string, ssoEmail?: string | null): string {
  return withSchedulerSso(`${baseUrl}/?job=${encodeURIComponent(jobId)}&view=schedule`, ssoEmail);
}

// One lookup per page render: the base URL plus the set of ETC job numbers that
// actually have a Scheduler project, so grids show the "open in Scheduler" icon
// only where it leads somewhere. Fail-soft — an unconfigured/unreachable
// Scheduler DB yields an empty set (no icons), never an error.
export async function getSchedulerLinkContext(): Promise<{
  baseUrl: string;
  jobNumbers: Set<string>;
  // Who to assert to the Scheduler on every link this page renders. Read here so
  // the four call sites don't each have to remember to fetch the session.
  ssoEmail: string | null;
}> {
  const [jobNumbers, session] = await Promise.all([fetchSchedulerProjectJobNumbers(), auth()]);
  return { baseUrl: getSchedulerBaseUrl(), jobNumbers, ssoEmail: session?.user?.email ?? null };
}

// Called from this app's own sign-out action (see (app)/layout.tsx) so
// logging out of Reports also invalidates any Scheduler session for the
// same person — the mirror of what the Scheduler's own logout does over
// here (POST /api/integration/revoke-session). Best-effort and time-boxed —
// short, since the two apps are on the same LAN host: a slow or unreachable
// Scheduler must never make signing out of THIS app hang or fail, and this
// app's own session is already gone by the time this runs regardless of
// whether the Scheduler call succeeds.
export async function revokeSchedulerSession(email: string | null | undefined): Promise<void> {
  const token = process.env.SCHEDULER_SHARED_TOKEN;
  if (!token || !email) return;
  await withTimeoutOrNull(
    "Scheduler session revoke",
    3000,
    async () => {
      await fetch(`${getSchedulerBaseUrl()}/api/auth/revoke-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email }),
      });
    },
    (e) => console.error("revokeSchedulerSession failed:", e),
  );
}

// Called from login/actions.ts's changePassword()/registerUser() so a LINKED person's
// two accounts keep working from the same credential — the mirror of what the
// Scheduler's own password change/admin reset does to this app (POST
// /api/integration/sync-password). Only the bcrypt HASH ever travels, never the
// plaintext — see that route's own header for why that's not "copying a password."
// Best-effort and time-boxed, same reasoning as revokeSchedulerSession above: this
// app's own password change already succeeded by the time this runs, and a slow or
// unreachable Scheduler must never make it look like the change failed. The Scheduler
// silently no-ops if this email isn't a linked account over there.
export async function syncPasswordHashToScheduler(email: string, passwordHash: string): Promise<void> {
  const token = process.env.SCHEDULER_SHARED_TOKEN;
  if (!token) return;
  await withTimeoutOrNull(
    "Scheduler password sync",
    3000,
    async () => {
      await fetch(`${getSchedulerBaseUrl()}/api/auth/sync-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email, passwordHash }),
      });
    },
    (e) => console.error("syncPasswordHashToScheduler failed:", e),
  );
}

// The pull half, used only at auto-provision time (auth.ts's scheduler-sso provider):
// a brand-new Reports account for a Scheduler-only person seeds its OWN hash from
// Scheduler's current one, so the same password works immediately on both sides
// instead of a throwaway one only the SSO hand-off can ever use. Returns null on
// anything short of a clean 200 (not configured, unreachable, no such Scheduler
// account, malformed response) — callers fall back to generating their own hash.
export async function fetchSchedulerPasswordHash(email: string): Promise<string | null> {
  const token = process.env.SCHEDULER_SHARED_TOKEN;
  if (!token) return null;
  return withTimeoutOrNull(
    "Scheduler password-hash fetch",
    3000,
    async () => {
      const res = await fetch(`${getSchedulerBaseUrl()}/api/auth/password-hash?email=${encodeURIComponent(email)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { passwordHash?: string };
      return body.passwordHash ?? null;
    },
    (e) => console.error("fetchSchedulerPasswordHash failed:", e),
  );
}
