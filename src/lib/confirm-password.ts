import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// The app's shared "are you sure" confirmation phrase.
//
// Not an access boundary — the whole app already sits behind sign-in
// (proxy.ts). This is the deliberate keystroke in front of an action that
// freezes or unfreezes live figures, so nobody does it by brushing a button.
//
// Checked server-side so the phrase never reaches the client bundle. Override
// with CONFIRM_PASSWORD; the default matches the phrase already used by Submit
// and Lock, the ETC edit gate, the Standard Sheet gate and the Projects gate.
//
// Those four each grew their own copy of this check before it was worth
// sharing. New gates should use this one rather than adding a fifth; the
// existing copies are left alone deliberately — quietly re-pointing a gate at a
// different constant is not the kind of change to make in passing.
export function matchesConfirmPassword(attempt: string): boolean {
  const expected = process.env.CONFIRM_PASSWORD || "sdcautomation";
  // Constant-time over same-length digests — a plain `===` on the raw strings
  // leaks match-length through timing.
  const a = createHmac("sha256", "cmp").update(attempt).digest();
  const b = createHmac("sha256", "cmp").update(expected).digest();
  return timingSafeEqual(a, b);
}
