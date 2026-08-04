"use server";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { expectedButtonPassword } from "@/lib/button-password";
import { revalidatePath } from "next/cache";

const COOKIE_NAME = "audit-log-unlocked";
const ERROR_COOKIE = "audit-log-error";

// Same pattern as standard-sheet-gate.ts — server-side check so the password
// never reaches the client bundle. Override via AUDIT_LOG_PASSWORD in .env.
// The dev fallback is refused in production: shipping with the well-known
// default would make the gate decorative (found 2026-07-14 — this gate had
// lagged behind its standard-sheet sibling on both hardening points below).
// One shared source for every protected button (lib/button-password.ts), with
// AUDIT_LOG_PASSWORD still able to override this gate specifically. The old
// throw-in-production-when-unset behaviour is gone with it: a missing env var used
// to take this page down entirely rather than fall back to a working gate.
function expectedPassword(): string {
  return expectedButtonPassword("auditLog");
}

// The unlock cookie holds an HMAC over a fixed message, keyed by the password
// (plus AUTH_SECRET when present) — a hand-crafted cookie set in dev tools
// can't forge it, unlike the old plain "1" flag.
function cookieToken(): string {
  const key = `${expectedPassword()}::${process.env.AUTH_SECRET ?? ""}`;
  return createHmac("sha256", key).update("audit-log-unlocked-v2").digest("hex");
}

// Constant-time equality on same-length digests of both sides — a plain `===`
// on the raw strings leaks match-length through timing.
function safeEqual(a: string, b: string): boolean {
  const da = createHmac("sha256", "cmp").update(a).digest();
  const db = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(da, db);
}

export async function isAuditLogUnlocked(): Promise<boolean> {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;
  return value != null && safeEqual(value, cookieToken());
}

export async function hadWrongAuditLogPassword(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(ERROR_COOKIE)?.value === "1";
}

export async function unlockAuditLog(formData: FormData): Promise<void> {
  const attempt = String(formData.get("password") ?? "");
  const cookieStore = await cookies();
  if (!safeEqual(attempt, expectedPassword())) {
    cookieStore.set(ERROR_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 });
  } else {
    // Session-scoped (no maxAge): closing the browser relocks the tab.
    cookieStore.set(COOKIE_NAME, cookieToken(), { httpOnly: true, sameSite: "lax", path: "/" });
    cookieStore.delete(ERROR_COOKIE);
  }
  revalidatePath("/audit-log");
}
