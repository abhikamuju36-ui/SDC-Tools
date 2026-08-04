import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { expectedButtonPassword } from "@/lib/button-password";
import { PROJECTS_EDIT_COOKIE } from "@/lib/projects-edit-cookie";

// The password gate on the Projects grid (/quoted). Two things sit behind it,
// and they are deliberately the same lock:
//
//   1. Edit Mode. The toggle does nothing until this is unlocked — before, any
//      signed-in user could flip the grid live and start typing into quoted
//      hours.
//   2. The four POOL sections — PM (10-111), Manufacturing (10-413), Warranty
//      Engineering (70-211) and Warranty Shop (70-411). They are absent from
//      the grid AND from the Sections picker, so there is nothing to reveal by
//      fiddling with the ?cols= parameter.
//
// Note the sections track EDIT MODE, not this gate directly (see
// quoted/page.tsx): unlocking is necessary but not sufficient, and switching
// back to Read-only hides them again. Unlocked-but-not-editing is the state
// most of a session sits in, and leaving the hours on screen for it would have
// meant one password entry exposing them for the rest of the browser session.
//
// One lock for both because they are the same question — "should this person be
// changing and seeing the standard-fee inputs" — and two passwords for one
// answer is how a gate ends up half-applied.
//
// Same construction as standard-sheet-gate.ts: the check is server-side so the
// password never reaches the client bundle, and the cookie holds an HMAC rather
// than a "1" flag so it can't be hand-forged in dev tools.
//
// The phrase comes from lib/button-password.ts, shared with every other protected
// button in the app, so changing it is one edit rather than seven.
// PROJECTS_PASSWORD still overrides it for this gate alone.
const COOKIE_NAME = "projects-unlocked";

function expectedPassword(): string {
  return expectedButtonPassword("projects");
}

function cookieToken(): string {
  const key = `${expectedPassword()}::${process.env.AUTH_SECRET ?? ""}`;
  return createHmac("sha256", key).update("projects-unlocked-v1").digest("hex");
}

// Constant-time equality on same-length digests of both sides — a plain `===`
// on the raw strings leaks match-length through timing.
function safeEqual(a: string, b: string): boolean {
  const da = createHmac("sha256", "cmp").update(a).digest();
  const db = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(da, db);
}

export async function isProjectsUnlocked(): Promise<boolean> {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;
  return value != null && safeEqual(value, cookieToken());
}

// ── Why these are NOT server actions ────────────────────────────────────────
//
// They were, and unlocking took seconds. Next re-renders the current route
// after EVERY server action, and rendering /quoted is nine sequential database
// round trips — the shared views, three job queries, the actual hours for every
// job, and getSchedulerLinkContext(), which reaches a DIFFERENT MySQL server
// over the network. ProjectsEditMode.tsx documents the same discovery about the
// Edit Mode switch, in almost the same words, for the same reason.
//
// And that re-render bought nothing. Since the restricted sections started
// following Edit Mode rather than this gate, unlocking changes only which
// toolbar controls are drawn — no column appears or disappears. So the whole
// page was being re-rendered to swap a password box for a toggle button.
//
// These are plain functions now, called from a route handler
// (app/api/projects/gate/route.ts) over fetch. A route handler sets cookies and
// returns JSON without touching the RSC tree, so unlocking costs one round trip
// and the toolbar swaps in client state. Locking is the same, except the caller
// refreshes afterwards IF it was editing, because that genuinely does remove
// columns.
export async function verifyProjectsPassword(attempt: string): Promise<boolean> {
  return safeEqual(attempt, expectedPassword());
}

export async function setProjectsUnlocked(): Promise<void> {
  const cookieStore = await cookies();
  // Session-scoped (no maxAge): closing the browser relocks the tab.
  cookieStore.set(COOKIE_NAME, cookieToken(), { httpOnly: true, sameSite: "lax", path: "/" });
}

// Drops back behind the gate without closing the browser. Also clears Edit
// Mode's own cookie: leaving the grid unlocked-for-editing behind a locked gate
// would be a state the toggle can't represent.
export async function clearProjectsUnlocked(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(PROJECTS_EDIT_COOKIE);
}
