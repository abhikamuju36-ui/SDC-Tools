import { test } from "node:test";
import assert from "node:assert/strict";
import {
  foldToast,
  capToasts,
  shouldSuppress,
  autoDismissMs,
  MAX_VISIBLE_TOASTS,
  type ToastItem,
} from "../src/lib/notification-stack";

// Two independent notification surfaces (Toast.tsx, ChangeNotifications.tsx) used to
// spread across two corners of the screen with no shared cap and, on Toast's side, no
// dedup at all. They now render into one stack; this file pins the half of the merged
// rules that belongs to arbitrary-message toasts (ChangeNotifications' own cap/dedup,
// keyed on a grid cell rather than a message, is unchanged and stays pinned by its own
// existing tests).

function item(over: Partial<ToastItem> = {}): ToastItem {
  return { id: 1, message: "Saved", type: "success", critical: false, count: 1, ...over };
}

// ── Dedup (foldToast) ────────────────────────────────────────────────────────

test("a brand new message is appended, not folded", () => {
  const { items, bumpedId } = foldToast([], { id: 1, message: "Saved", type: "success", critical: false });
  assert.deepEqual(items, [item({ id: 1, count: 1 })]);
  assert.equal(bumpedId, null);
});

test("an identical (message, type) toast is bumped, not stacked as a second card", () => {
  const existing = [item({ id: 1, count: 1 })];
  const { items, bumpedId } = foldToast(existing, { id: 2, message: "Saved", type: "success", critical: false });
  assert.equal(items.length, 1, "still one card, not two");
  assert.equal(items[0].count, 2);
  assert.equal(items[0].id, 1, "the SURVIVING id is the original card's, so its own timer is the one re-scheduled");
  assert.equal(bumpedId, 1);
});

test("the same wording but a DIFFERENT type is a different toast, not a bump", () => {
  const existing = [item({ id: 1, type: "success", count: 1 })];
  const { items, bumpedId } = foldToast(existing, { id: 2, message: "Saved", type: "error", critical: false });
  assert.equal(items.length, 2, "success and error versions of the same words are not the same fact");
  assert.equal(bumpedId, null);
});

test("two DIFFERENT messages of the same shape are never merged into one", () => {
  // The dedup key is the exact string. "Copied 1101" and "Copied 1104" are two
  // different facts and merging them would hide the second copy entirely.
  const existing = [item({ id: 1, message: "Copied 1101", count: 1 })];
  const { items, bumpedId } = foldToast(existing, { id: 2, message: "Copied 1104", type: "success", critical: false });
  assert.equal(items.length, 2);
  assert.equal(bumpedId, null);
});

test("a bumped toast moves to the end — it is the most recent, whatever its original position", () => {
  const existing = [item({ id: 1, message: "A", count: 1 }), item({ id: 2, message: "B", count: 1 })];
  const { items } = foldToast(existing, { id: 3, message: "A", type: "success", critical: false });
  assert.deepEqual(items.map((t) => t.message), ["B", "A"]);
});

test("bumping takes the LATEST call's critical flag, not the first one's", () => {
  const existing = [item({ id: 1, critical: false, count: 1 })];
  const { items } = foldToast(existing, { id: 2, message: "Saved", type: "success", critical: true });
  assert.equal(items[0].critical, true);
});

test("bumping repeatedly keeps incrementing, not resetting to 2", () => {
  let items: ToastItem[] = [];
  for (let i = 0; i < 5; i++) {
    items = foldToast(items, { id: i + 1, message: "Saved", type: "success", critical: false }).items;
  }
  assert.equal(items.length, 1);
  assert.equal(items[0].count, 5);
});

// ── Cap (capToasts) ──────────────────────────────────────────────────────────

test("under the cap, nothing is trimmed", () => {
  const items = [item({ id: 1 }), item({ id: 2, message: "B" })];
  assert.deepEqual(capToasts(items, MAX_VISIBLE_TOASTS), items);
});

test("over the cap, the OLDEST non-critical items are trimmed first", () => {
  const items = [1, 2, 3, 4, 5].map((n) => item({ id: n, message: `M${n}` }));
  const kept = capToasts(items, 3);
  assert.deepEqual(kept.map((t) => t.id), [3, 4, 5], "the three most recent survive");
});

test("a burst of routine toasts cannot push a critical one off screen", () => {
  const critical = item({ id: 99, message: "Refresh failed", critical: true });
  const routine = [1, 2, 3, 4, 5].map((n) => item({ id: n, message: `M${n}` }));
  const items = [critical, ...routine]; // critical arrived FIRST, i.e. is the "oldest"
  const kept = capToasts(items, 3);
  assert.ok(kept.some((t) => t.id === 99), "the critical toast survives even though it is the oldest");
  assert.equal(kept.length, 3);
});

test("every critical toast survives even if critical items alone exceed the cap", () => {
  const critical = [1, 2, 3, 4].map((n) => item({ id: n, message: `C${n}`, critical: true }));
  const kept = capToasts(critical, 2);
  assert.equal(kept.length, 4, "the cap does not drop a critical message; see the note in the source");
});

test("relative order survives a trim — no reordering just because some items were cut", () => {
  const items = [1, 2, 3, 4, 5].map((n) => item({ id: n, message: `M${n}` }));
  const kept = capToasts(items, 3);
  const ids = kept.map((t) => t.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), "still oldest-to-newest, not shuffled");
});

// ── Suppression (shouldSuppress) ─────────────────────────────────────────────

test("not suppressed anywhere outside the three named subtrees", () => {
  assert.equal(shouldSuppress(false, false), false);
  assert.equal(shouldSuppress(false, true), false);
});

test("a routine toast IS suppressed inside a suppressed subtree", () => {
  assert.equal(shouldSuppress(true, false), true);
  assert.equal(shouldSuppress(true, undefined), true);
});

test("a critical toast is NEVER suppressed, even inside a suppressed subtree", () => {
  // This is the one property the whole suppression feature must not get backwards:
  // Job Cost Explorer / Standard Sheet / Standard Card are told to stop generating
  // routine noise, not to stop reporting a save failure or a permission error.
  assert.equal(shouldSuppress(true, true), false);
});

// ── Timing (autoDismissMs) ────────────────────────────────────────────────────

test("errors linger longer than confirmations", () => {
  assert.ok(autoDismissMs("error") > autoDismissMs("success"));
  assert.ok(autoDismissMs("error") > autoDismissMs("info"));
});
