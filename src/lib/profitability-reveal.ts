// The Profitability nav-item reveal, as client state (§84).
//
// ── What this is for ─────────────────────────────────────────────────────────
//
// Profitability (job-cost-explorer) is hidden from the sidebar by default. Clicking
// "Projects" three times in a row, inside a short window, reveals it in its normal
// position — discoverable by whoever already knows the gesture, invisible to
// everyone else. Same shape as lib/standards-reveal.ts's double-click-on-Monthly-ETC
// gesture: a module-level store plus a click streak with a timeout, read via
// useSyncExternalStore so the reveal survives the sidebar re-rendering on every
// route change (a ref would not — see that file's own note on the same point).
//
// ── Not a security boundary ───────────────────────────────────────────────────
//
// This decides whether the NAV LINK is drawn, nothing else. The route itself keeps
// whatever authentication/password gate it already had — typing the URL directly,
// or a bookmark, reaches exactly the same check it always did. Revealing the link
// only saves someone who already knows the destination exists from typing the URL
// by hand; it grants no access nobody already had.
//
// ── Why session-only means "no storage API at all" ────────────────────────────
//
// "Persist for the session, forget on logout / a new session / an app restart" is
// exactly what a plain module-level variable already does, and what localStorage or
// sessionStorage would NOT: this module's state lives only in the current page's JS
// realm, so a full reload — a new tab, a browser restart, or the redirect signing
// out causes — re-imports the module at its initial value with nothing to clear.
// Client-side navigation between routes does NOT reload it, which is the other half
// of the requirement: once revealed, it stays revealed while the user keeps
// browsing normally, exactly as long as "session" means "before the next full load".

type Listener = () => void;

let revealed = false;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((cb) => cb());
}

export function readProfitabilityRevealed(): boolean {
  return revealed;
}

/** Server snapshot: never revealed on a fresh render — every visitor's first paint
 *  hides the item, exactly matching the client's own pre-gesture default, so there
 *  is nothing for hydration to reconcile and nothing flashes into view on load. */
export function serverProfitabilityRevealed(): boolean {
  return false;
}

export function subscribeProfitabilityReveal(onChange: Listener): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function reveal(): void {
  if (revealed) return; // already shown — do not wake subscribers for nothing
  revealed = true;
  emit();
}

// ── The gesture ───────────────────────────────────────────────────────────────

/**
 * Clicks needed on the sidebar's Projects item, and the window they must land in.
 * Three, not two: Projects is a real, frequently-used destination (unlike Monthly
 * ETC's double-click target, which does nothing on a single click besides
 * navigate), so the threshold needs to be high enough that ordinary use — clicking
 * it, leaving, coming back a minute later, clicking it again — can never cross it
 * by accident. ~2s is long enough for three unhurried clicks and short enough that
 * two clicks minutes apart never combine into a third.
 */
export const PROJECTS_GESTURE_CLICKS = 3;
export const PROJECTS_GESTURE_WINDOW_MS = 2000;

let streak = 0;
let streakTimer: ReturnType<typeof setTimeout> | null = null;

function clearStreak(): void {
  streak = 0;
  if (streakTimer) clearTimeout(streakTimer);
  streakTimer = null;
}

/**
 * Register one click on the sidebar's Projects item. Never suppresses the
 * navigation that click already causes — unlike the Monthly ETC gesture (which
 * opens a box IN PLACE of navigating), clicking Projects three times means "go to
 * Projects" three genuine times. The reveal is a side effect that happens beside
 * the navigation, not instead of it.
 */
export function noteProjectsClick(): void {
  streak += 1;
  if (streakTimer) clearTimeout(streakTimer);
  if (streak >= PROJECTS_GESTURE_CLICKS) {
    clearStreak();
    reveal();
    return;
  }
  streakTimer = setTimeout(clearStreak, PROJECTS_GESTURE_WINDOW_MS);
}

/**
 * A click on any OTHER sidebar nav item breaks the streak — the gesture is three
 * CONSECUTIVE Projects clicks, not three landing inside one window with an
 * unrelated click in between.
 */
export function noteOtherNavClick(): void {
  if (streak !== 0) clearStreak();
}

/** Test seam — the streak and the reveal are module state, so a test needs a way
 *  back to the start the way resetStandardsForTest gives lib/standards-reveal.ts's
 *  own tests one. */
export function resetProfitabilityRevealForTest(): void {
  revealed = false;
  clearStreak();
  listeners.clear();
}
