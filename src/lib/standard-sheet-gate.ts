"use server";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { expectedButtonPassword } from "@/lib/button-password";
import { revalidatePath } from "next/cache";

const COOKIE_NAME = "standard-sheet-unlocked";
const ERROR_COOKIE = "standard-sheet-error";

// Server-side check — the password never reaches the client bundle (the old
// client-component gate shipped it in page JS, readable by any signed-in
// manager via dev tools). Override via STANDARD_SHEET_PASSWORD in .env.
// The dev fallback is refused in production: shipping with the well-known
// default would make the gate decorative.
// One shared source for every protected button (lib/button-password.ts).
// STANDARD_SHEET_PASSWORD still overrides this gate specifically, since it guards
// confidential figures and its owners may want a distinct phrase.
function expectedPassword(): string {
  return expectedButtonPassword("standardSheet");
}

// The unlock cookie holds an HMAC over a fixed message, keyed by the password
// (plus AUTH_SECRET when present) — a hand-crafted cookie set in dev tools
// can't forge it, unlike the old plain "1" flag.
function cookieToken(): string {
  const key = `${expectedPassword()}::${process.env.AUTH_SECRET ?? ""}`;
  return createHmac("sha256", key).update("standard-sheet-unlocked-v2").digest("hex");
}

// Constant-time equality on same-length digests of both sides — a plain `===`
// on the raw strings leaks match-length through timing.
function safeEqual(a: string, b: string): boolean {
  const da = createHmac("sha256", "cmp").update(a).digest();
  const db = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(da, db);
}

export async function isStandardSheetUnlocked(): Promise<boolean> {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;
  return value != null && safeEqual(value, cookieToken());
}

// Guard for every Standard Sheet mutation action — rendering hiding the grid
// is not enough, since server actions are directly callable by any signed-in
// user who captures the action IDs.
export async function assertStandardSheetUnlocked(): Promise<void> {
  if (!(await isStandardSheetUnlocked())) {
    throw new Error("The Standard Sheet is locked — enter the Standard Sheet password first.");
  }
}

export async function hadWrongPassword(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(ERROR_COOKIE)?.value === "1";
}

/**
 * Check the password, set the cookie, and SAY SO — nothing else (§48).
 *
 * ── Why this returns a result instead of revalidating ────────────────────────
 *
 * It used to be a `<form action={…}>` handler ending in `revalidatePath("/etc")`, which
 * meant revealing the Standard Fees card cost a complete re-render of the Monthly ETC
 * page. Measured on the running app: **2,911ms, 4 requests and 190KB** to show a card
 * whose figures the server had just finished computing on the render before.
 *
 * It also revalidated on the WRONG password, so a typo cost the same 190KB as a success.
 *
 * Now it answers one question and the client decides what to do with the answer: reveal
 * the card from local state, or keep the box open with an error. §48's "do not use
 * router.push(), router.refresh(), or a full server render only to show the card".
 *
 * The security model is unchanged and unweakened. The phrase is still compared
 * server-side in constant time and never reaches the browser; the reply is one boolean,
 * which tells an attacker exactly what a 200-vs-error already told them. The cookie is
 * still the authority — every Standard Sheet mutation calls assertStandardSheetUnlocked,
 * and the figures are still only ever rendered for a request that carries it.
 */
export async function verifyStandardSheetPassword(attempt: string): Promise<{ ok: boolean }> {
  const cookieStore = await cookies();
  if (!safeEqual(attempt, expectedPassword())) {
    return { ok: false };
  }
  // Session-scoped (no maxAge): closing the browser relocks the tab.
  cookieStore.set(COOKIE_NAME, cookieToken(), { httpOnly: true, sameSite: "lax", path: "/" });
  cookieStore.delete(ERROR_COOKIE);
  return { ok: true };
}

/**
 * The old form-action entry point, kept for the no-JavaScript path only.
 *
 * A `<form action>` still works if the client never hydrates, and this is the one control
 * in the app behind which sits a whole page of confidential figures — losing it to a
 * bundle that failed to load would be a poor trade for deleting nine lines. It keeps the
 * error cookie and the revalidate, because without JavaScript there is nothing else to
 * carry either.
 */
export async function unlockStandardSheet(formData: FormData): Promise<void> {
  const attempt = String(formData.get("password") ?? "");
  const cookieStore = await cookies();
  if (!safeEqual(attempt, expectedPassword())) {
    // A wrong password is expected user input, not an application error —
    // flag it in a short-lived cookie the gate form reads back.
    cookieStore.set(ERROR_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 });
  } else {
    cookieStore.set(COOKIE_NAME, cookieToken(), { httpOnly: true, sameSite: "lax", path: "/" });
    cookieStore.delete(ERROR_COOKIE);
  }
  revalidatePath("/etc");
}

// Relocks the tab (used by the "Hide Standards" button on the ETC grid, and
// anywhere else that wants to drop back behind the gate without closing the
// browser).
export async function lockStandardSheet(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(ERROR_COOKIE);
  revalidatePath("/etc");
}
