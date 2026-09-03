"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  decodeSplit,
  isSplittable,
  navigateActivePane,
  openInSplit,
  splitHref,
  pairingRefusal,
  splitRoute,
  type SplitState,
} from "@/lib/split-view";

// ── What the sidebar needs to know about split view ─────────────────────────
//
// Two questions, and they have different answers depending on whether a split is
// already open:
//
//   Where does a plain click go?   Not split: the route itself, unchanged.
//                                  Split: the same /split URL with the ACTIVE pane's
//                                  route replaced — which is the requirement that
//                                  "sidebar navigation opens in the currently active
//                                  pane" and, just as importantly, that it leaves the
//                                  other pane completely alone.
//
//   Where does "Open in Split      Not split: /split with the CURRENT page on the
//   View" go?                      left (carrying its own params) and the target on
//                                  the right.
//                                  Split: replace the INACTIVE pane, so the pane you
//                                  are working in survives — right-clicking a third
//                                  page while split should not disturb the one you
//                                  are reading.
//
// Kept out of Sidebar.tsx because it is pure URL derivation with no markup, and
// because Sidebar is already a thousand lines of nav ordering and drag-reorder.

export function useSplitNav() {
  const pathname = usePathname();
  const search = useSearchParams();

  // The live split state, when there is one. `search.toString()` in the dep list
  // rather than the object: useSearchParams returns a new instance per render.
  const searchKey = search.toString();
  const state: SplitState | null = useMemo(() => {
    if (pathname !== "/split") return null;
    return decodeSplit(Object.fromEntries(new URLSearchParams(searchKey)));
  }, [pathname, searchKey]);

  /** The current page's own params — what travels with it when it becomes a pane. */
  const currentParams = useMemo(() => {
    const route = splitRoute(pathname);
    if (!route) return {};
    const sp = new URLSearchParams(searchKey);
    const out: Record<string, string> = {};
    for (const key of route.params) {
      const v = sp.get(key);
      if (v !== null) out[key] = v;
    }
    return out;
  }, [pathname, searchKey]);

  /** Where a normal sidebar click on `href` should actually go. */
  const hrefFor = useCallback(
    (href: string): string => {
      if (!state || !isSplittable(href)) return href;
      // Navigating the active pane to a route already open in the OTHER pane, when
      // that route may only be open once (Monthly ETC - see pairingRefusal), would
      // create the very pairing /split refuses. Leaving split view and opening the
      // page full width is the useful reading of that click, and it is what the
      // menu's own disabled state explains.
      const other = state.active === "l" ? state.r?.path : state.l.path;
      if (pairingRefusal(href, other)) return href;
      return splitHref(navigateActivePane(state, href));
    },
    [state],
  );

  /**
   * Why `href` cannot be opened right now, or null when it can. Shown on the menu
   * entry, so a refusal explains itself instead of looking like a dead control.
   */
  const refusalFor = useCallback(
    (href: string): string | null => {
      if (!state) return null;
      const other = state.active === "l" ? state.r?.path : state.l.path;
      return pairingRefusal(href, other);
    },
    [state],
  );

  /**
   * Where "Open in Split View" on `href` should go, or null when it cannot apply —
   * a route that is not splittable, or one that is already the pane it would open
   * into (opening Projects beside Projects-in-the-same-pane is a no-op the menu
   * should not offer).
   */
  const splitHrefFor = useCallback(
    (href: string): string | null => {
      if (!isSplittable(href)) return null;

      if (!state) {
        // Not split yet: the page you are on stays put and becomes the left pane.
        // Refuse when the current page cannot be a pane (an admin screen), since
        // there would be nothing to keep on the left.
        if (!isSplittable(pathname)) return null;
        // Monthly ETC beside Monthly ETC, from the ETC page itself.
        if (pairingRefusal(href, pathname)) return null;
        return splitHref(openInSplit({ path: pathname, params: currentParams }, { path: href }));
      }

      // Already split: aim at the pane you are NOT working in.
      const target = state.active === "l" ? "r" : "l";
      // ...unless that would leave an exclusive route in both panes.
      const staying = target === "l" ? state.r?.path : state.l.path;
      if (pairingRefusal(href, staying)) return null;
      const next: SplitState = { ...state, active: target };
      return splitHref(navigateActivePane(next, href));
    },
    [state, pathname, currentParams],
  );

  return {
    /** True when a two-pane split is on screen right now. */
    isSplit: state != null,
    /** Which pane a plain sidebar click will land in, for the menu's own wording. */
    activePane: state?.active ?? null,
    state,
    hrefFor,
    splitHrefFor,
    refusalFor,
  };
}
