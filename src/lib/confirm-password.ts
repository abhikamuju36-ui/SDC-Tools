import "server-only";
import { expectedButtonPassword, matchesButtonPassword } from "@/lib/button-password";

// The app's shared "are you sure" confirmation phrase.
//
// Not an access boundary — the whole app already sits behind sign-in (proxy.ts).
// This is the deliberate keystroke in front of an action that freezes or unfreezes
// live figures, so nobody does it by brushing a button.
//
// ── Now a thin wrapper (2026-08-04) ─────────────────────────────────────────
// The note that used to live here said the five gates each grew their own copy of
// this check, and that re-pointing them at one constant was "not the kind of change
// to make in passing". Changing the shared phrase on 2026-08-04 was the
// occasion to do it deliberately: all five now resolve through
// lib/button-password.ts, so there is one place to change and no way for a gate to
// be left behind on the old phrase. CONFIRM_PASSWORD still overrides this one.
export function matchesConfirmPassword(attempt: string): boolean {
  return matchesButtonPassword(attempt, "confirm");
}

// Exported for the gates that need the phrase itself rather than a comparison —
// they key an HMAC cookie with it. Server-only, like everything in this file.
export { expectedButtonPassword };
