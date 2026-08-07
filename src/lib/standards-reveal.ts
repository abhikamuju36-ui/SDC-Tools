// The Standard Fees gesture and reveal, as client state (§48).
//
// ── What this replaces, and what it cost ────────────────────────────────────
//
// The hidden entry point used to be a URL: three clicks on the sidebar's "Monthly ETC"
// item inside 1500ms, then `router.push("/etc?standards=1")`, and the page rendered a
// password box only when that flag was present.
//
// Every part of that was a server round trip. The item is a <Link href="/etc">, so each
// of the three counting clicks NAVIGATED — three full renders of the heaviest page in
// the app (49 jobs x 83 columns, the KPI card, every query behind them) — and then the
// push was a fourth. Measured on the running app before this change:
//
//     first click -> password box on screen : 6,077ms, 8 requests
//
// Six seconds to show a text input, and none of the work had anything to do with the
// input. Submitting it then cost a fifth render, because `unlockStandardSheet` ended in
// `revalidatePath("/etc")`: 2,911ms and 190KB to reveal a card whose data the server had
// just finished computing.
//
// So the gesture stops touching the URL. It sets a boolean here, the toolbar's gate
// component reads it, and the box appears on the same frame — no navigation, no render,
// nothing refetched. §48's "do not reload the complete Monthly ETC route, table, KPI
// card, or page" is satisfied by there being no request at all.
//
// ── Why a module store rather than context ──────────────────────────────────
//
// The sidebar and the ETC toolbar are in different subtrees — the sidebar lives in the
// (app) layout, the toolbar inside the page — so a provider that covered both would have
// to wrap the whole application to carry one boolean between two leaves. Same shape as
// lib/app-zoom.ts and lib/nav-order.ts: a module-level value, an event, and
// useSyncExternalStore.
//
// ── It is not a security boundary ──────────────────────────────────────────
//
// Nothing here decides whether the figures are shown; it decides whether the PASSWORD
// BOX is shown. The gate is still the HMAC cookie checked server-side
// (lib/standard-sheet-gate.ts), every Standard Sheet mutation still calls
// assertStandardSheetUnlocked, and the confidential figures are still only ever sent to
// a client that already holds the cookie. A user who sets `promptOpen` by hand in dev
// tools gets a password box, which they could already reach by typing the old URL.

// No window event, unlike lib/app-zoom.ts and lib/sidebar-prefs.ts: those are
// preferences that other TABS should learn about. This is a per-tab reveal — the whole
// point is that unlocking here does not unlock anywhere else — so the subscriber set is
// the entire notification mechanism.
type State = {
  /** The password box is on screen. */
  promptOpen: boolean;
  /**
   * The password has been accepted in THIS tab, so the card may render from client
   * state without waiting for a server render. Never the authority for whether the
   * figures exist — the server only sends them to a request carrying the cookie.
   */
  unlocked: boolean;
  /**
   * The Standard Sheet columns and the Standard Fees card are both collapsed by
   * choice, in a tab that is otherwise still authorized (§76 — "Fix Standard Sheet
   * and Standard Fees Visibility"). Deliberately a THIRD field, not a repurposing of
   * `unlocked`: `unlocked` already has an established meaning ("has this tab proven
   * the password") that both `StandardsGate` and `StandardFeesCard` depend on, and
   * folding "currently displayed" into it would mean re-checking the password just
   * to bring a hidden view back — which is exactly the round trip §48 removed.
   *
   * `hidden` starts `false` on every fresh render (server and client snapshots
   * agree), so there is no seeding race and no flash-of-content to guard against —
   * unlike `unlocked`, nothing needs to happen on mount for the default case to be
   * correct.
   */
  hidden: boolean;
};

let state: State = { promptOpen: false, unlocked: false, hidden: false };
const listeners = new Set<() => void>();

function emit() {
  // Snapshot identity has to change for useSyncExternalStore to see it, and must NOT
  // change when nothing did — it compares with Object.is and would loop forever on a
  // fresh object per read.
  listeners.forEach((cb) => cb());
}

export function readStandardsState(): State {
  return state;
}

/** Server snapshot: the box is never open on a fresh render. */
export function serverStandardsState(): State {
  return CLOSED;
}
const CLOSED: State = Object.freeze({ promptOpen: false, unlocked: false, hidden: false });

export function subscribeStandards(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/**
 * Open the password box.
 *
 * Idempotent by construction, which is §48's "repeated clicks must not open duplicate
 * prompts": there is one boolean and one component reading it, so a second, third or
 * tenth call cannot produce a second box. The old URL flag had the same property by
 * luck; this has it by design.
 */
export function openStandardsPrompt(): void {
  if (state.promptOpen) return; // nothing changed — do not wake the subscribers
  state = { ...state, promptOpen: true };
  emit();
}

export function closeStandardsPrompt(): void {
  if (!state.promptOpen) return;
  state = { ...state, promptOpen: false };
  emit();
}

/** Called after the server action reports the password was right. */
export function markStandardsUnlocked(): void {
  state = { promptOpen: false, unlocked: true, hidden: false };
  emit();
}

/**
 * Revokes this tab's reveal outright — the password will be asked for again. Not
 * currently wired to any button (§76 renamed the toolbar's "Hide Standards" to a
 * pure visibility toggle instead — see hideStandardSheet below); kept for whatever
 * eventually wants a real relock rather than a collapse.
 */
export function markStandardsLocked(): void {
  state = { promptOpen: false, unlocked: false, hidden: false };
  emit();
}

// ── Hide / Show, without touching the unlock (§76) ──────────────────────────
//
// The toolbar's "Standards" button used to submit a real `<form action={lockStandardSheet}>`
// — clearing the server cookie and calling `revalidatePath("/etc")` to hide the grid's
// Standard Sheet columns. That IS immediate for the columns (they are server JSX, gone
// the moment the page re-renders without the cookie) but it never told THIS store the
// reveal had ended, so `StandardFeesCard` — which decides its own visibility from
// `unlocked` — kept right on showing whatever it last fetched. Two components, two
// notions of "hidden", and only one of them moved.
//
// The fix is not to make the button ALSO call `markStandardsLocked()`: that would fix
// the card but reintroduce the OTHER half of the bug for "Show Standards" afterwards —
// revoking the cookie means the grid's columns, which only ever come down as part of a
// full server render, cannot come back without one, so showing again would need the same
// `revalidatePath` round trip §48 already proved is too slow for this page. A relock and
// an instant re-reveal cannot both be true of the same action.
//
// So hiding stays a pure DISPLAY toggle. The cookie is never touched, the grid's columns
// and the card's fetched figures stay exactly where they are in memory, and both of
// these plus `!hidden` is the one condition every Standard Sheet consumer now checks —
// EtcStandardCells, StandardGrandCells, the two header blocks in page.tsx, and
// StandardFeesCard's own `show`. Toggling therefore costs nothing: no request, no
// re-render, no risk of losing an unsaved Contingency/Notes edit sitting in one of the
// grid's own inputs, because nothing about the grid's mount ever changes.

/** "Hide Standards" — collapses the columns and the card in this tab. Still authorized. */
export function hideStandardSheet(): void {
  if (state.hidden) return; // nothing changed — do not wake the subscribers
  state = { ...state, hidden: true };
  emit();
}

/** "Show Standards" when this tab is already authorized — the reverse, equally instant. */
export function revealStandardSheet(): void {
  if (!state.hidden) return;
  state = { ...state, hidden: false };
  emit();
}

// ── The gesture ─────────────────────────────────────────────────────────────

/**
 * Clicks needed on the sidebar item, and the window they must land in.
 *
 * TWO, not the old three: §48 asks for a double-click, and three-inside-1500ms was
 * genuinely unreliable — each counting click also navigated, so the round trip ate most
 * of the window and the third click regularly arrived after the streak had reset. With
 * no navigation in the way, two clicks inside 600ms is a deliberate gesture that lands
 * first time.
 *
 * Still deliberately undiscoverable: a double-click on a nav item you are already on is
 * not something anyone does by accident, and the box it opens asks for a password.
 */
export const GESTURE_CLICKS = 2;
export const GESTURE_WINDOW_MS = 600;

let streak = 0;
let streakTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Register one click on the sidebar's Monthly ETC item.
 *
 * Returns true when the gesture completed, so the caller can suppress the navigation
 * that click would otherwise cause. State lives in this module rather than a ref in the
 * component because the sidebar re-renders on every route change, and a streak that
 * resets when the user navigates is a streak that cannot be completed across a
 * navigation.
 */
export function noteEtcClick(): boolean {
  streak += 1;
  if (streakTimer) clearTimeout(streakTimer);
  if (streak >= GESTURE_CLICKS) {
    streak = 0;
    streakTimer = null;
    openStandardsPrompt();
    return true;
  }
  streakTimer = setTimeout(() => {
    streak = 0;
    streakTimer = null;
  }, GESTURE_WINDOW_MS);
  return false;
}

/** Test seam — the streak is module state, so a test needs a way back to zero. */
export function resetStandardsForTest(): void {
  state = { promptOpen: false, unlocked: false, hidden: false };
  streak = 0;
  if (streakTimer) clearTimeout(streakTimer);
  streakTimer = null;
  listeners.clear();
}
