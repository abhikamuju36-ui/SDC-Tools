"use server";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { PROJECTS_EDIT_COOKIE } from "@/lib/projects-edit-cookie";

// The password gate on the Projects grid (/quoted). Two things sit behind it,
// and they are deliberately the same lock:
//
//   1. Edit Mode. The toggle does nothing until this is unlocked — before, any
//      signed-in user could flip the grid live and start typing into quoted
//      hours.
//   2. The four POOL sections — PM (10-111), Manufacturing (10-413), Warranty
//      Engineering (70-211) and Warranty Shop (70-411). Locked, they are absent
//      from the grid AND from the Sections picker, so there is nothing to
//      reveal by fiddling with the ?cols= parameter.
//
// One lock for both because they are the same question — "should this person be
// changing and seeing the standard-fee inputs" — and two passwords for one
// answer is how a gate ends up half-applied.
//
// Same construction as standard-sheet-gate.ts: the check is server-side so the
// password never reaches the client bundle, and the cookie holds an HMAC rather
// than a "1" flag so it can't be hand-forged in dev tools.
//
// The password is "sdcautomation" by default, matching the Monthly ETC gates
// (etc-edit-gate.ts, SUBMIT_LOCK_PASSWORD). Unlike standard-sheet-gate.ts this
// does NOT refuse to start without an env override — that gate guards frozen
// financial history, this one guards a grid every manager uses daily, and
// failing the page closed on a missing env var would be the worse outcome. Set
// PROJECTS_PASSWORD to override.
const COOKIE_NAME = "projects-unlocked";

function expectedPassword(): string {
  return process.env.PROJECTS_PASSWORD || "sdcautomation";
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

// Returns whether the attempt was accepted, rather than flagging a failure in
// a short-lived cookie the way standard-sheet-gate.ts does. The caller is a
// client component that awaits this directly (it has to be — see
// ProjectsGateControl for why a <form> can't be used here), so it can just hold
// the failure in state; a cookie round-trip would be a worse version of the
// same thing.
export async function unlockProjects(formData: FormData): Promise<{ ok: boolean }> {
  const attempt = String(formData.get("password") ?? "");
  if (!safeEqual(attempt, expectedPassword())) return { ok: false };

  const cookieStore = await cookies();
  // Session-scoped (no maxAge): closing the browser relocks the tab.
  cookieStore.set(COOKIE_NAME, cookieToken(), { httpOnly: true, sameSite: "lax", path: "/" });
  // Unlike the Edit Mode switch — which is client state precisely to avoid this
  // round trip — unlocking MUST re-render: the four restricted columns don't
  // exist in the current markup, and only the server can add them.
  revalidatePath("/quoted");
  return { ok: true };
}

// Drops back behind the gate without closing the browser. Also clears Edit
// Mode's own cookie: leaving the grid unlocked-for-editing behind a locked gate
// would be a state the toggle can't represent.
export async function lockProjects(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(PROJECTS_EDIT_COOKIE);
  revalidatePath("/quoted");
}
