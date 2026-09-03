"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  decodeSplit,
  isSplittable,
  normalizePath,
  navigateActivePane,
  openInSplit,
  splitHref,
  pairingRefusal,
  splitRoute,
  type SplitState,
} from "@/lib/split-view";
import {
  EMPTY_WORKSPACE,
  MAX_TABS,
  decodeWorkspace,
  enterSplit,
  navigateTab,
  openTab,
  sidebarTarget,
  workspaceHref,
  type Workspace,
} from "@/lib/workspace";

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

  // ── The workspace, when we are on /w ─────────────────────────────────────
  //
  // Two layouts now share this hook, and they are mutually exclusive by pathname:
  // /split is the older two-pane route, /w is the tabbed workspace. Keeping both here
  // rather than adding a second hook is deliberate — Sidebar asks ONE question ("where
  // does this click go?") and there must be exactly one answer, not two hooks racing
  // to produce an href.
  const workspace: Workspace | null = useMemo(() => {
    if (pathname !== "/w") return null;
    return decodeWorkspace(Object.fromEntries(new URLSearchParams(searchKey)));
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
      if (!isSplittable(href)) return href;

      // ── In the workspace ───────────────────────────────────────────────
      //
      // Split open: replace the ACTIVE tab's route and leave the other pane alone —
      // the same contract /split has. Opening a new tab instead would leave the split
      // showing the two tabs it already had, so the page just asked for would render
      // nowhere visible and the click would look like it did nothing.
      //
      // Not split: open it as a tab, which activates an existing tab for that page
      // rather than duplicating it (see lib/workspace.ts). At the tab cap openTab
      // recycles the oldest unused tab rather than refusing, so a click here always
      // goes somewhere.
      if (workspace) {
        if (workspace.split) {
          const other =
            workspace.split.left === workspace.active
              ? workspace.tabs[workspace.split.right]?.path
              : workspace.tabs[workspace.split.left]?.path;
          // Would create the one pairing /w refuses (Monthly ETC twice). Leaving the
          // workspace and opening the page full width is the useful reading of the
          // click, and it is what the menu's own refusal explains.
          if (pairingRefusal(href, other)) return href;
          return workspaceHref(navigateTab(workspace, sidebarTarget(workspace), href));
        }
        return workspaceHref(openTab(workspace, href));
      }

      if (!state) return href;
      // Navigating the active pane to a route already open in the OTHER pane, when
      // that route may only be open once (Monthly ETC - see pairingRefusal), would
      // create the very pairing /split refuses. Leaving split view and opening the
      // page full width is the useful reading of that click, and it is what the
      // menu's own disabled state explains.
      const other = state.active === "l" ? state.r?.path : state.l.path;
      if (pairingRefusal(href, other)) return href;
      return splitHref(navigateActivePane(state, href));
    },
    [state, workspace],
  );

  /**
   * Why `href` cannot be opened right now, or null when it can. Shown on the menu
   * entry, so a refusal explains itself instead of looking like a dead control.
   */
  const refusalFor = useCallback(
    (href: string): string | null => {
      if (workspace) {
        if (workspace.tabs.length >= MAX_TABS && !workspace.tabs.some((t) => t.path === href)) {
          return `At the ${MAX_TABS}-tab limit — close a tab to open another`;
        }
        return pairingRefusal(href, workspace.tabs[sidebarTarget(workspace)]?.path);
      }
      if (!state) return null;
      const other = state.active === "l" ? state.r?.path : state.l.path;
      return pairingRefusal(href, other);
    },
    [state, workspace],
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

      if (workspace) {
        // Already in the workspace: split the tab you are on against `href`, opening it
        // as a tab first if it is not open yet. enterSplit takes a tab ID because the
        // split is a view onto tabs that already exist — see lib/workspace.ts.
        const anchorTab = sidebarTarget(workspace);
        if (pairingRefusal(href, workspace.tabs[anchorTab]?.path)) return null;
        const opened = openTab(workspace, href);
        // openTab refused (every tab is in use at the cap), or `href` IS the tab we
        // would be splitting against. Neither is a split.
        if (opened.active === anchorTab) return null;
        return workspaceHref(enterSplit({ ...opened, active: anchorTab }, opened.active));
      }

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
    [state, workspace, pathname, currentParams],
  );

  /**
   * Where "Open in a new tab" should go — the only way INTO the workspace from an
   * ordinary page, since the tab strip only exists on /w.
   *
   * From a normal route it builds a two-tab workspace: the page you are on, carrying
   * its own params, plus the target, which becomes active. From inside the workspace it
   * is just openTab. Null when it cannot apply — an unhostable current page (an admin
   * screen) would leave nothing to keep as the first tab.
   */
  const newTabHrefFor = useCallback(
    (href: string): string | null => {
      if (!isSplittable(href)) return null;
      if (workspace) {
        const opened = openTab(workspace, href);
        return opened === workspace ? null : workspaceHref(opened);
      }
      if (state) return null; // /split has its own two-pane model; use Expand first
      if (!isSplittable(pathname)) return null;
      if (normalizePath(pathname) === normalizePath(href)) return null; // already here
      const base = openTab(EMPTY_WORKSPACE, pathname, currentParams);
      return workspaceHref(openTab(base, href));
    },
    [workspace, state, pathname, currentParams],
  );

  return {
    /** True when a two-pane split is on screen right now — either layout. */
    isSplit: state != null || workspace?.split != null,
    /** True when the tabbed workspace is what is on screen. */
    isWorkspace: workspace != null,
    workspace,
    newTabHrefFor,
    /** Which pane a plain sidebar click will land in, for the menu's own wording. */
    activePane: state?.active ?? null,
    state,
    hrefFor,
    splitHrefFor,
    refusalFor,
  };
}
