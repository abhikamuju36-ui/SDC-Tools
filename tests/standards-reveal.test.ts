import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GESTURE_CLICKS,
  GESTURE_WINDOW_MS,
  closeStandardsPrompt,
  hideStandardSheet,
  markStandardsLocked,
  markStandardsUnlocked,
  noteEtcClick,
  openStandardsPrompt,
  readStandardsState,
  resetStandardsForTest,
  revealStandardSheet,
  serverStandardsState,
  subscribeStandards,
} from "../src/lib/standards-reveal";

// ── Show Standards, made instant (§48) ──────────────────────────────────────
//
// Measured on the running app before the change:
//
//   first sidebar click -> password box  6,077ms   8 requests
//   submit -> answer                     2,911ms   4 requests   190KB
//
// Both were server round trips doing work unrelated to what the user asked for: the
// sidebar item is a <Link>, so all three counting clicks navigated, and
// `unlockStandardSheet` ended in `revalidatePath("/etc")` — a complete re-render of the
// heaviest page in the app to reveal one card, on the wrong password as well as the right
// one.
//
// After: 8ms / 0 requests to open, 43ms / 1 request / 0KB to answer.
//
// These tests hold the two properties that made that possible and would be easy to undo.

const SRC = join(import.meta.dirname, "..", "src");

/**
 * Comments stripped before searching. Every one of these files documents what it
 * replaced — including the old `?standards=1` URL and the old revalidate — and a guard
 * that trips on its own explanation is a guard people delete.
 */
function code(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*$/gm, "")
    .replace(/\/\/[^\n"'`]*$/gm, "");
}

const GATE = code("lib", "standard-sheet-gate.ts");
const CARD_ACTION = code("lib", "standard-fees-card.ts");
const SIDEBAR = code("components", "Sidebar.tsx");
const GATE_UI = code("components", "StandardsGate.tsx");
const CARD_UI = code("components", "StandardFeesCard.tsx");
const COLUMNS_UI = code("components", "EtcStandardColumns.tsx");
const ETC_PAGE = code("app", "(app)", "etc", "page.tsx");

beforeEach(() => resetStandardsForTest());

// ── The gesture (criteria 1, 2) ─────────────────────────────────────────────

test("the gesture is a double-click inside a short window", () => {
  assert.equal(GESTURE_CLICKS, 2, "§48 asks for a double-click");
  assert.ok(GESTURE_WINDOW_MS <= 800, "a deliberate gesture, not a slow one");
  // The old window was 1500ms and still unreliable, because each counting click navigated
  // and the round trip ate it. With no navigation, shorter is both safer and steadier.
  assert.ok(GESTURE_WINDOW_MS >= 300, "…but long enough for a human double-click");
});

test("one click does nothing; the second completes it", () => {
  assert.equal(noteEtcClick(), false, "a single click must stay a plain navigation");
  assert.equal(readStandardsState().promptOpen, false);
  assert.equal(noteEtcClick(), true, "the second click completes the gesture");
  assert.equal(readStandardsState().promptOpen, true);
});

test("repeated clicks cannot open a second prompt", () => {
  // Criterion 2. There is one boolean and one component reading it, so this is a property
  // of the design rather than of a guard — but the guard is what a later refactor would
  // remove, so it is pinned.
  let notifications = 0;
  subscribeStandards(() => notifications++);
  for (let i = 0; i < 12; i++) noteEtcClick();
  assert.equal(readStandardsState().promptOpen, true);
  // Six completed gestures, but the state only ever CHANGED once: openStandardsPrompt
  // returns early when it is already open, so the subscribers are not woken for nothing.
  assert.equal(notifications, 1, `expected one state change, got ${notifications}`);
});

test("the streak survives a re-render and resets on its own", async () => {
  // The streak is module state, not a ref: the sidebar re-renders on every route change,
  // and a streak that resets when the user navigates cannot be completed across one.
  assert.equal(noteEtcClick(), false);
  await new Promise((r) => setTimeout(r, GESTURE_WINDOW_MS + 80));
  assert.equal(noteEtcClick(), false, "a click after the window starts a fresh streak");
  assert.equal(readStandardsState().promptOpen, false);
});

// ── The reveal (criteria 3, 4) ───────────────────────────────────────────────

test("the server snapshot never opens the prompt", () => {
  // It is rendered on the server for every visitor; a truthy snapshot would put a password
  // box on the page for everyone.
  assert.deepEqual(serverStandardsState(), { promptOpen: false, unlocked: false, hidden: false });
});

test("accepting the password closes the prompt and reveals in one step", () => {
  openStandardsPrompt();
  markStandardsUnlocked();
  assert.deepEqual(readStandardsState(), { promptOpen: false, unlocked: true, hidden: false });
});

test("locking drops both", () => {
  markStandardsUnlocked();
  markStandardsLocked();
  assert.deepEqual(readStandardsState(), { promptOpen: false, unlocked: false, hidden: false });
});

test("escaping the prompt does not unlock anything", () => {
  openStandardsPrompt();
  closeStandardsPrompt();
  assert.deepEqual(readStandardsState(), { promptOpen: false, unlocked: false, hidden: false });
});

// ── Standard Sheet and Standard Fees hide/show together (§76) ───────────────
//
// The bug: clicking the toolbar's "Standards" button submitted a real
// `<form action={lockStandardSheet}>` — clearing the unlock cookie and revalidating the
// whole page. That hid the grid's columns (server JSX, gone once the render lacks the
// cookie) but never told this store the reveal had ended, so StandardFeesCard — which
// decides its own visibility from `unlocked` — kept showing stale figures. Two
// components, two notions of "hidden".
//
// The fix adds ONE more flag, `hidden`, that every Standard Sheet consumer now checks
// alongside its existing visibility condition. These tests hold the properties that
// make the fix actually work: hide/show is instant (no request, which the OTHER half of
// this file already proves nothing here ever costs), it never disturbs `unlocked` or
// `promptOpen` (so a genuine relock and a mere collapse stay two different things), and
// it does not repeat notifications for a state that has not changed.

test("hiding does not touch the authorization state", () => {
  markStandardsUnlocked();
  hideStandardSheet();
  const state = readStandardsState();
  assert.equal(state.hidden, true);
  assert.equal(state.unlocked, true, "hiding must not revoke the tab's authorization");
  assert.equal(state.promptOpen, false);
});

test("showing again after a hide needs no password", () => {
  markStandardsUnlocked();
  hideStandardSheet();
  revealStandardSheet();
  assert.deepEqual(readStandardsState(), { promptOpen: false, unlocked: true, hidden: false });
});

test("hide and show are each idempotent — no duplicate notifications", () => {
  let notifications = 0;
  subscribeStandards(() => notifications++);
  hideStandardSheet();
  hideStandardSheet();
  hideStandardSheet();
  assert.equal(notifications, 1, "repeated hides must not wake subscribers again");
  revealStandardSheet();
  revealStandardSheet();
  assert.equal(notifications, 2, "one more notification for the one real change back");
});

test("hidden defaults to false, so a fresh render never opens already-collapsed", () => {
  // No seeding, no bootstrap effect, no flash: both snapshots start unhidden, exactly
  // like `unlocked` and `promptOpen` already do — see the note beside the `hidden`
  // field for why that is what makes this safe to add without a mount-time race.
  assert.equal(serverStandardsState().hidden, false);
  assert.equal(readStandardsState().hidden, false);
});

test("every Standard Sheet consumer checks the same hidden flag", () => {
  // The grid's per-row cells, its grand-total row, the two header blocks, and the
  // Fees card must all read `hidden` from THIS module — not a locally re-derived
  // boolean, which is exactly how the original bug had two independent answers.
  assert.match(COLUMNS_UI, /if \(!std \|\| hidden\) return null;/, "EtcStandardCells must hide with the row's own data");
  assert.match(COLUMNS_UI, /if \(hidden\) return null;/, "StandardGrandCells must hide too");
  assert.match(COLUMNS_UI, /export function StandardHeaderVisible/, "the header blocks need the same gate");
  assert.match(CARD_UI, /&& !hidden/, "the card's own show formula must veto on hidden");
});

test("the header blocks in the grid are wrapped, not left to hide alone", () => {
  const occurrences = ETC_PAGE.match(/<StandardHeaderVisible>/g) ?? [];
  assert.equal(occurrences.length, 2, "both header blocks (the banner and the leaf labels) must be wrapped");
});

test("hiding never clears the card's already-fetched figures", () => {
  // §76's "values are preserved when hidden and shown again". `setData(null)` legitimately
  // appears twice already — the "Try again" retry and the month-switch resync — so the
  // guard is not "never call it" but "never call it BECAUSE of `hidden`": nothing in the
  // file may read `hidden` anywhere near clearing the cached figures.
  assert.doesNotMatch(CARD_UI, /hidden[\s\S]{0,80}setData\(null\)/, "hiding must not discard cached figures");
  assert.doesNotMatch(CARD_UI, /setData\(null\)[\s\S]{0,80}hidden/, "…in either order");
});

test("the toggle button handles its own click and never lets the form submit", () => {
  // The instant path only works if the real <form action={lockAction}> (the no-JS
  // fallback, kept deliberately per §48's reasoning) is prevented once JS has hydrated
  // — otherwise every click would ALSO relock and revalidate, silently reintroducing
  // the slow path this fixes.
  const toggle = GATE_UI.slice(GATE_UI.indexOf("export function StandardsVisibilityToggle"));
  assert.match(toggle, /e\.preventDefault\(\)/, "the client handler must suppress the form submission");
  assert.match(toggle, /hideStandardSheet\(\)/);
  assert.match(toggle, /revealStandardSheet\(\)/);
  assert.doesNotMatch(toggle, /revalidatePath|router\.(push|refresh)/, "the toggle itself must never trigger a re-render");
});

test("the toolbar no longer submits Hide straight to the server action", () => {
  // The old `<form action={lockStandardSheet}>` around a plain submit button is gone —
  // it is StandardsVisibilityToggle now, which still ACCEPTS lockAction (for the no-JS
  // path) but intercepts the click before that form ever fires.
  assert.doesNotMatch(ETC_PAGE, /<form action=\{lockStandardSheet\}>/, "the bare form-submits-to-lock button must be gone");
  assert.match(ETC_PAGE, /<StandardsVisibilityToggle lockAction=\{lockStandardSheet\}/, "the toggle must still carry the no-JS fallback through");
});

// ── No round trip is reintroduced (the whole point) ─────────────────────────

test("the gesture never touches the URL", () => {
  // `router.push("/etc?standards=1")` was the 6,077ms. A navigation to open a text input
  // is the thing this change removed, and it is one line to put back.
  assert.doesNotMatch(SIDEBAR, /standards=1/, "the gesture must not navigate to a flag URL");
  assert.match(SIDEBAR, /noteEtcClick\(\)/, "…it must go through the store");
  assert.match(SIDEBAR, /if \(onEtc\) e\.preventDefault\(\)/, "…and must not navigate to the page it is on");
});

test("password validation returns a result instead of revalidating the route", () => {
  // The 2,911ms / 190KB. `verifyStandardSheetPassword` must not revalidate; the legacy
  // form action still may, because without JavaScript there is nothing else to carry the
  // answer.
  const verify = GATE.slice(GATE.indexOf("export async function verifyStandardSheetPassword"));
  const body = verify.slice(0, verify.indexOf("\n}\n") + 3);
  assert.doesNotMatch(body, /revalidatePath/, "verifying a password must not re-render the page");
  assert.match(body, /Promise<\{ ok: boolean \}>/, "it must answer the client instead");
  // And the client must actually use that answer rather than reloading.
  assert.match(GATE_UI, /verifyStandardSheetPassword/);
  assert.doesNotMatch(GATE_UI, /router\.(push|refresh)/, "§48 forbids a route change to show the card");
  assert.doesNotMatch(CARD_UI, /router\.(push|refresh)/);
});

test("only the Show Standards button is disabled while checking", () => {
  // §48: "disable only the Show Standards button during validation. Keep the rest of the
  // app responsive." The input must stay usable so a typo can be corrected in place.
  assert.match(GATE_UI, /disabled=\{pending\}/);
  const input = GATE_UI.slice(GATE_UI.indexOf("<input"), GATE_UI.indexOf("<button"));
  assert.doesNotMatch(input, /disabled/, "the password field must not be disabled");
});

test("the button and the panel can never stay stuck loading", () => {
  // §48: "clear the loading state on success, failure, timeout, or cancellation" and
  // "never leave the panel or button stuck loading indefinitely".
  assert.match(GATE_UI, /catch \{[\s\S]{0,200}?setError/, "a failed action must surface, not hang");
  assert.match(CARD_UI, /\.finally\(/, "the card's load must clear its indicator on every path");
  assert.match(CARD_UI, /Try again/, "…and offer a way forward after a failure");
});

// ── The card loads only itself, and only when allowed ───────────────────────

test("the card's data action is gated before it reads anything", () => {
  // A server action is directly callable by anyone who captures its id, so the cookie
  // check is the actual boundary — not the page deciding whether to render.
  const first = CARD_ACTION.slice(CARD_ACTION.indexOf("export async function getStandardFeesCard"));
  const guardAt = first.indexOf("assertStandardSheetUnlocked");
  const readAt = Math.min(
    ...["prisma.", "loadEffectivePools", "newProjectsEnteringMonth", "checkMonthlyReport"]
      .map((s) => first.indexOf(s))
      .filter((i) => i >= 0),
  );
  assert.ok(guardAt > 0, "the action must assert the gate");
  assert.ok(guardAt < readAt, "…before it reads a single figure");
});

test("the confidential figures are not sent to a locked visitor", () => {
  // §48 asks to "preload or SAFELY cache" the data on page load. Safely means: only when
  // the request already carried the cookie. `initialData` is therefore conditional on
  // showStandards, and a locked page ships null.
  const page = code("app", "(app)", "etc", "page.tsx");
  assert.match(page, /initialData=\{\s*showStandards\s*\?/, "initialData must be gated on the server check");
  assert.match(page, /:\s*null\s*\}/, "…and be null otherwise");
});

test("the card asks for its own inputs and nothing else", () => {
  // §48: "do not refetch Monthly ETC grid data", "do not recalculate unrelated formulas or
  // KPI values". The action must not reach for the grid's own loaders.
  for (const forbidden of ["getEtcMonthJobWhere", "buildKpiBlocks", "getPartsCost", "groupHoursRows"]) {
    assert.ok(!CARD_ACTION.includes(forbidden), `the card action must not pull in ${forbidden}`);
  }
});

test("one definition of the four pools", () => {
  // POOL_PANEL_META moved out of the page so the card build and the grid columns read the
  // same list. Two copies would be visible immediately — the card sits beside the columns.
  const meta = code("lib", "pool-panel-meta.ts");
  assert.match(meta, /ENGINEERING_PM/);
  const page = code("app", "(app)", "etc", "page.tsx");
  assert.match(page, /from "@\/lib\/pool-panel-meta"/, "the page must import it");
  assert.doesNotMatch(page, /const POOL_PANEL_META = \[/, "…not declare a second copy");
  assert.match(CARD_ACTION, /from "@\/lib\/pool-panel-meta"/);
});
