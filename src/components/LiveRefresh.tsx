"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isSavingSomewhere } from "@/lib/autosave";

// Keeps an OPEN page in step with what other people have saved.
//
// ── The bug this exists for (2026-08-04) ────────────────────────────────────
// "When I change a value in any cell, other users are not seeing the updated
// value." The obvious suspect was the missing revalidatePath on the save paths.
// It was not that, and it is worth writing down why, because it is the opposite
// of what the Next.js caching documentation leads you to expect:
//
//   * Every route in this app is DYNAMICALLY rendered. app/(app)/layout.tsx
//     awaits next-auth's auth(), which reads cookies, and that forces every page
//     under the (app) group dynamic. The production build agrees — only /login
//     and /_not-found are static.
//   * Nothing in the app uses a Next server-side cache: no unstable_cache, no
//     "use cache", no route-segment revalidate, and `fetch` is uncached by
//     default in this version. Every page reads through Prisma, which is outside
//     Next's caching entirely.
//
// So there was never a stale server cache to invalidate. Every revalidatePath()
// call in the codebase is, server-side, a no-op — its real effect is to make the
// calling action's own response carry a fresh render, which is exactly why the
// person saving always saw their own change and nobody else did.
//
// The actual cause was simpler and had no Next.js in it at all: NOTHING asked the
// server again. No polling, no websocket, no refetch on focus. A page was a
// snapshot taken when it loaded, and it stayed that snapshot until someone
// reloaded by hand. This component is the missing "ask again".
//
// ── Why router.refresh() is the right instrument ────────────────────────────
// It re-fetches the current route's payload from the server. Because the routes
// are dynamic, that is a real database read every time — no cache to defeat. And
// it preserves component state, which is what makes it safe to fire under
// someone's hands: an input the user is typing in keeps their text (see the
// clean/dirty rule in EtcSectionCells, PartsCostNewEtcCell and MoneyCell, which
// adopt a changed server value ONLY when the user has not diverged from it).
//
// ── When it fires ───────────────────────────────────────────────────────────
//   * on focus / tab becoming visible — the high-value trigger. Coming back to a
//     tab is exactly when you expect to see current numbers.
//   * on a slow interval while visible — so a page left open on a second monitor
//     converges without being touched.
//   * on demand, via requestLiveRefresh(), used after a save is refused because
//     another user got there first.
//
// A hidden tab does nothing at all: no interval, no fetch. There is no point
// re-rendering a page nobody is looking at, and on this grid that render is the
// expensive part (59 jobs x 13 sections).

// Deliberately unhurried. The ETC page is the heaviest render in the app and this
// runs per open tab, so the interval is a background safety net rather than the
// primary mechanism — focus/visibility is what people actually notice. 45s means a
// figure someone else saved is on screen within a minute without being asked for.
const DEFAULT_INTERVAL_MS = 45_000;

// Callers that want to postpone a refresh: a grid with unsaved typing in it. Not a
// hard lock — the blocker only suppresses the BACKGROUND interval, never an
// explicit requestLiveRefresh(), because a refused write has to be corrected on
// screen immediately whatever else is going on.
type Blocker = () => boolean;
const blockers = new Set<Blocker>();

export function registerRefreshBlocker(fn: Blocker): () => void {
  blockers.add(fn);
  return () => blockers.delete(fn);
}

function backgroundRefreshBlocked(): boolean {
  for (const b of blockers) {
    try {
      if (b()) return true;
    } catch {
      // A throwing blocker must not take the whole refresh loop down with it.
    }
  }
  return false;
}

// Set by the mounted component so any client module can ask for a refresh without
// prop-drilling or a context — the same module-scope-store pattern the dirty
// tracker and the live totals already use in this codebase.
let refreshNow: (() => void) | null = null;

export function requestLiveRefresh(): void {
  refreshNow?.();
}

// ── The same request, but at most once per window ───────────────────────────
//
// For callers reacting to a STREAM of events rather than to one decision. The
// realtime change feed is the case: a colleague autosaving a column announces one
// event per cell, and before 2026-08-04 each one triggered a full route refetch —
// 854 KB and a ~600ms server render, per cell, in every open tab. Most of those
// events are now applied to the individual cell with no network at all
// (lib/etc-remote-values.ts); this is the fallback for the ones that cannot be, and
// a burst of them must cost ONE refresh.
//
// Leading edge, then a quiet window: the first event refreshes immediately (so a
// change is on screen at once) and further ones inside the window collapse into a
// single trailing refresh. A pure debounce would delay the first, and a pure throttle
// would drop the last — which on a stream of changes is the one that matters.
const THROTTLE_MS = 5_000;
let lastThrottledAt = 0;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;

export function requestThrottledLiveRefresh(): void {
  const now = Date.now();
  if (now - lastThrottledAt >= THROTTLE_MS) {
    lastThrottledAt = now;
    refreshNow?.();
    return;
  }
  if (trailingTimer) return; // one trailing refresh already scheduled
  trailingTimer = setTimeout(() => {
    trailingTimer = null;
    lastThrottledAt = Date.now();
    refreshNow?.();
  }, THROTTLE_MS - (now - lastThrottledAt));
}

export function LiveRefresh({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    // Coalesce: focus and visibilitychange both fire on a single tab switch in
    // some browsers, and a burst of requestLiveRefresh() calls should be one
    // render, not five.
    let queued = false;
    const run = () => {
      if (queued) return;
      queued = true;
      // A microtask-ish gap is enough to merge the burst without adding a
      // perceptible delay to the focus case.
      setTimeout(() => {
        queued = false;
        // Checked HERE rather than only on the interval path, so it covers focus and
        // visibility too (found by review 2026-08-04 — those two bypassed it). A
        // refresh mid-save can deliver a payload rendered before the write
        // committed, putting the OLD number on screen for a moment: the next pass
        // corrects it, but "my save was undone" is exactly the complaint being
        // fixed, so don't manufacture it.
        //
        // This does NOT swallow the post-conflict requestLiveRefresh(): the save has
        // already resolved by then, so endSaveTracking() has run before this fires.
        if (isSavingSomewhere()) return;
        router.refresh();
      }, 50);
    };

    refreshNow = run;

    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    const onFocus = () => run();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (backgroundRefreshBlocked()) return;
      run();
    }, intervalMs);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
      if (refreshNow === run) refreshNow = null;
    };
  }, [router, intervalMs]);

  return null;
}
