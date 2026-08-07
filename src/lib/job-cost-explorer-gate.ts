"use server";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const COOKIE_NAME = "job-cost-explorer-unlocked";
const ERROR_COOKIE = "job-cost-explorer-error";

// Same HMAC-cookie pattern as audit-log-gate.ts / standard-sheet-gate.ts, but
// deliberately NOT routed through lib/button-password.ts: that module is one
// shared "are-you-sure" phrase in front of five destructive-action gates
// (Submit, Reopen, Sync History, Standard Sheet, Audit Log) — this is a
// distinct, specific ACCESS password for a whole tab, unrelated to that
// shared phrase. Default is "lisasdc"; JOB_COST_EXPLORER_PASSWORD in .env
// overrides it, for the same future flexibility every other gate has.
function expectedPassword(): string {
  const configured = process.env.JOB_COST_EXPLORER_PASSWORD;
  return configured && configured.length > 0 ? configured : "lisasdc";
}

// The unlock cookie holds an HMAC over a fixed message, keyed by the password
// (plus AUTH_SECRET when present) — never the password itself, and never
// sent to the client as anything but this opaque digest.
function cookieToken(): string {
  const key = `${expectedPassword()}::${process.env.AUTH_SECRET ?? ""}`;
  return createHmac("sha256", key).update("job-cost-explorer-unlocked-v1").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const da = createHmac("sha256", "cmp").update(a).digest();
  const db = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(da, db);
}

export async function isJobCostExplorerUnlocked(): Promise<boolean> {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;
  return value != null && safeEqual(value, cookieToken());
}

export async function hadWrongJobCostExplorerPassword(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(ERROR_COOKIE)?.value === "1";
}

export async function unlockJobCostExplorer(formData: FormData): Promise<void> {
  const attempt = String(formData.get("password") ?? "");
  const cookieStore = await cookies();
  if (!safeEqual(attempt, expectedPassword())) {
    cookieStore.set(ERROR_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 });
  } else {
    // Session-scoped (no maxAge): closing the browser relocks the tab.
    cookieStore.set(COOKIE_NAME, cookieToken(), { httpOnly: true, sameSite: "lax", path: "/" });
    cookieStore.delete(ERROR_COOKIE);
  }
  revalidatePath("/job-cost-explorer");
}
