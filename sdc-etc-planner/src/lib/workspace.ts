import { SPLIT_ROUTES, isSplittable, normalizePath, splitRoute, clampRatio, DEFAULT_RATIO } from "@/lib/split-view";

// ── The workspace: one source of truth for tabs and the split ────────────────
//
// Requested 2026-09-03: browser-style tabs across the top of the Reports content
// area, and a Split View that picks a second OPEN TAB to show beside the active one.
//
// The architecture requirement was explicit — "one centralized source of truth for
// open tabs → active tab → tab state → split-view state → left/right split tabs",
// at the shell level, not inside any page. This file is that source of truth, and it
// is deliberately pure: no React, no DOM, no Prisma. Every rule below is provable in
// tests/workspace.test.ts rather than only observable by clicking.
//
// ── Built on the split-view model, not beside it ────────────────────────────
//
// lib/split-view.ts already established the parts this needs: SPLIT_ROUTES (the
// twelve routes that can be hosted, and which params each one owns),
// `normalizePath`, and the ratio clamping. A tab is the same thing a pane was — a
// route plus its own params — so a tab list is that model with N entries instead of
// two, and the split becomes a reference to two of them rather than a separate
// state.
//
// That last point matters and is the reason this replaces rather than wraps the
// earlier `SplitState`: with the split holding its own copies of two panes, a tab and
// "the same page in the split" were two states that could disagree. Here the split
// holds TAB IDS, so there is exactly one copy of any page's params and closing a tab
// that is in the split is a defined operation rather than a leak.
//
// ── Why the URL ─────────────────────────────────────────────────────────────
//
// Same reasoning as split-view.ts: App Refresh is a full frontend reload that keeps
// only the URL, so a URL satisfies "restore my tabs" with no code, and gets browser
// refresh, Back/Forward and "send someone my exact workspace" for free.
//
//     /w?t=/etc,/job-hours&a=1&t0.month=2026-08&t1.jobs=1131&s=0:1&r=50
//
// `t` is the ordered tab list, so reordering is a reordering of that array and needs
// no per-tab id in the URL. Params are namespaced by tab INDEX (`t0.`, `t1.`), which
// is what keeps two tabs on the same route from colliding — the exact property the
// `l.`/`r.` prefixes gave the split.

/** A tab's identity within a workspace: its index in the ordered list. */
export type TabId = number;

export type Tab = {
  path: string;
  /** That route's own params, un-namespaced — what the page would read from its own URL. */
  params: Record<string, string>;
};

export type Workspace = {
  /** Ordered, as shown in the tab bar. Left to right. */
  tabs: Tab[];
  /** Index into `tabs`. Always valid when there is at least one tab. */
  active: TabId;
  /**
   * Which two tabs the split shows, or null for the ordinary one-tab-at-a-time view.
   * Holds INDICES, not copies — see the header.
   */
  split: { left: TabId; right: TabId; ratio: number } | null;
};

export const MAX_TABS = 8;

/** The workspace a bare visit lands on. */
export const EMPTY_WORKSPACE: Workspace = { tabs: [], active: 0, split: null };

/** Only the params a route declares — see split-view.ts's SPLIT_ROUTES comment. */
function pickParams(path: string, params: Record<string, string>): Record<string, string> {
  const route = splitRoute(path);
  if (!route) return {};
  const out: Record<string, string> = {};
  for (const key of route.params) if (params[key] !== undefined) out[key] = params[key];
  return out;
}

export const tabLabel = (t: Tab): string => splitRoute(t.path)?.label ?? t.path;

/** Every route the tab bar's "+" can offer. */
export const openableRoutes = () => SPLIT_ROUTES;

// ── Opening ─────────────────────────────────────────────────────────────────

/**
 * Open `path`, or activate the tab already showing it.
 *
 * "If the page is already open, activate its existing tab instead of creating a
 * duplicate" — matched on PATH alone, deliberately not on path+params. Clicking
 * Monthly ETC in the sidebar while a Monthly ETC tab is open on a different month
 * should take you to that tab, not open a second one; a user who wants two months
 * side by side reaches for Split View, which is what it is for.
 */
export function openTab(ws: Workspace, path: string, params: Record<string, string> = {}): Workspace {
  const p = normalizePath(path);
  if (!isSplittable(p)) return ws;

  const existing = ws.tabs.findIndex((t) => t.path === p);
  if (existing >= 0) return { ...ws, active: existing };

  // At the cap, the OLDEST tab that is neither active nor in the split is replaced.
  // Refusing to open would leave a sidebar click doing nothing, which reads as broken;
  // dropping a tab the user is looking at would be worse than either.
  if (ws.tabs.length >= MAX_TABS) {
    const protectedIds = new Set<number>([ws.active, ...(ws.split ? [ws.split.left, ws.split.right] : [])]);
    const victim = ws.tabs.findIndex((_, i) => !protectedIds.has(i));
    if (victim < 0) return ws; // every tab is in use; leave the workspace alone
    const tabs = [...ws.tabs];
    tabs[victim] = { path: p, params: pickParams(p, params) };
    return { ...ws, tabs, active: victim };
  }

  const tabs = [...ws.tabs, { path: p, params: pickParams(p, params) }];
  return { ...ws, tabs, active: tabs.length - 1 };
}

export function activateTab(ws: Workspace, id: TabId): Workspace {
  if (id < 0 || id >= ws.tabs.length) return ws;
  return { ...ws, active: id };
}

/** Replace one tab's params — a job picked, a month changed — touching no other tab. */
export function setTabParams(ws: Workspace, id: TabId, params: Record<string, string>): Workspace {
  const tab = ws.tabs[id];
  if (!tab) return ws;
  const tabs = [...ws.tabs];
  tabs[id] = { path: tab.path, params: pickParams(tab.path, params) };
  return { ...ws, tabs };
}

// ── Closing ─────────────────────────────────────────────────────────────────

/**
 * Close a tab, and repair everything that pointed at it by index.
 *
 * This is the operation most likely to corrupt the workspace, because `active` and
 * both split references are indices into the array being spliced. Every one of them
 * shifts, and a stale index renders the wrong page or crashes.
 */
export function closeTab(ws: Workspace, id: TabId): Workspace {
  if (id < 0 || id >= ws.tabs.length) return ws;
  const tabs = ws.tabs.filter((_, i) => i !== id);
  if (tabs.length === 0) return EMPTY_WORKSPACE;

  // An index above the removed one shifts down by one; the removed one itself
  // resolves to its neighbour, which is what a browser does.
  const shift = (i: TabId): TabId => (i > id ? i - 1 : i);
  const active = id === ws.active ? Math.min(shift(ws.active), tabs.length - 1) : shift(ws.active);

  let split = ws.split;
  if (split) {
    if (split.left === id || split.right === id) {
      // Closing a tab that is IN the split ends the split rather than leaving one
      // pane pointing at nothing. The survivor becomes the ordinary active tab.
      const survivor = split.left === id ? split.right : split.left;
      return { tabs, active: Math.min(shift(survivor), tabs.length - 1), split: null };
    }
    split = { ...split, left: shift(split.left), right: shift(split.right) };
  }
  return { tabs, active: Math.max(0, active), split };
}

// ── Reordering ──────────────────────────────────────────────────────────────

/**
 * Move a tab, dragging every index that pointed at it along with it.
 *
 * Same hazard as closing: `active` and the split hold positions, so a reorder that
 * only moves the array silently repoints them at whatever slid into place.
 */
export function moveTab(ws: Workspace, from: TabId, to: TabId): Workspace {
  if (from === to) return ws;
  if (from < 0 || from >= ws.tabs.length) return ws;
  const target = Math.max(0, Math.min(to, ws.tabs.length - 1));

  const tabs = [...ws.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(target, 0, moved);

  // Where did an index end up? Follow the same splice.
  const remap = (i: TabId): TabId => {
    if (i === from) return target;
    let next = i;
    if (i > from) next -= 1;
    if (next >= target) next += 1;
    return Math.max(0, Math.min(next, tabs.length - 1));
  };

  return {
    tabs,
    active: remap(ws.active),
    split: ws.split ? { ...ws.split, left: remap(ws.split.left), right: remap(ws.split.right) } : null,
  };
}

// ── Split view ──────────────────────────────────────────────────────────────

/**
 * Show `other` beside the active tab.
 *
 * Takes a tab ID rather than a path, because the requested dialog offers "currently
 * open tabs as the primary choices" — the split is a view onto tabs that already
 * exist, which is what keeps a page's params in exactly one place.
 */
export function enterSplit(ws: Workspace, other: TabId, ratio: number = DEFAULT_RATIO): Workspace {
  if (other < 0 || other >= ws.tabs.length) return ws;
  if (other === ws.active) return ws; // a tab cannot be split against itself
  return { ...ws, split: { left: ws.active, right: other, ratio: clampRatio(ratio) } };
}

/** Leave the split, keeping `keep` (default: the left pane) as the active tab. */
export function exitSplit(ws: Workspace, keep?: TabId): Workspace {
  if (!ws.split) return ws;
  const target = keep ?? ws.split.left;
  return { tabs: ws.tabs, active: Math.max(0, Math.min(target, ws.tabs.length - 1)), split: null };
}

export function setSplitRatio(ws: Workspace, ratio: number): Workspace {
  if (!ws.split) return ws;
  return { ...ws, split: { ...ws.split, ratio: clampRatio(ratio) } };
}

/**
 * Which tab a sidebar click should land in.
 *
 * While split, the sidebar targets the tab the user was last in — `active` — and the
 * split keeps showing it, so navigating one pane leaves the other alone. That is the
 * same contract the earlier `navigateActivePane` had.
 */
export function sidebarTarget(ws: Workspace): TabId {
  return ws.active;
}

// ── URL ─────────────────────────────────────────────────────────────────────

export type RawParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export const tabParamKey = (id: TabId, key: string): string => `t${id}.${key}`;

export function encodeWorkspace(ws: Workspace): string {
  const sp = new URLSearchParams();
  if (ws.tabs.length === 0) return "";
  sp.set("t", ws.tabs.map((t) => t.path).join(","));
  ws.tabs.forEach((t, i) => {
    for (const [k, v] of Object.entries(t.params)) sp.set(tabParamKey(i, k), v);
  });
  // Absent means 0, so the commonest workspace carries no noise.
  if (ws.active !== 0) sp.set("a", String(ws.active));
  if (ws.split) {
    sp.set("s", `${ws.split.left}:${ws.split.right}`);
    sp.set("r", String(clampRatio(ws.split.ratio)));
  }
  return sp.toString();
}

export const workspaceHref = (ws: Workspace): string => {
  const q = encodeWorkspace(ws);
  return q ? `/w?${q}` : "/w";
};

/**
 * Read a workspace out of the URL.
 *
 * Deliberately total: a URL is user-editable and is also what survives a reload, so
 * every malformed input resolves to something usable rather than a blank app. An
 * unknown route is dropped from the list; an out-of-range `a` or `s` falls back
 * rather than pointing at a tab that does not exist.
 */
export function decodeWorkspace(raw: RawParams): Workspace {
  const list = (one(raw.t) ?? "")
    .split(",")
    // Empty segments are dropped BEFORE normalizePath, not after. That order matters:
    // normalizePath("") returns "/", which is a real route (the Dashboard), so
    // `?t=` or `?t=/etc,,/jobs` would otherwise conjure Dashboard tabs nobody asked
    // for. An absent segment means no tab.
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => normalizePath(p))
    .filter((p) => isSplittable(p));
  if (list.length === 0) return EMPTY_WORKSPACE;

  const tabs: Tab[] = list.slice(0, MAX_TABS).map((path, i) => {
    const route = splitRoute(path);
    const params: Record<string, string> = {};
    for (const key of route?.params ?? []) {
      const v = one(raw[tabParamKey(i, key)]);
      // Present-but-empty is kept: /job-hours reads `?jobs=` as "the picker was
      // cleared" and distinguishes it from absent. See split-view.ts.
      if (v !== undefined) params[key] = v;
    }
    return { path, params };
  });

  const activeRaw = Number(one(raw.a) ?? 0);
  const active = Number.isInteger(activeRaw) && activeRaw >= 0 && activeRaw < tabs.length ? activeRaw : 0;

  let split: Workspace["split"] = null;
  const s = one(raw.s);
  if (s) {
    const [l, r] = s.split(":").map((n) => Number(n));
    const valid =
      Number.isInteger(l) && Number.isInteger(r) && l !== r &&
      l >= 0 && l < tabs.length && r >= 0 && r < tabs.length;
    if (valid) split = { left: l, right: r, ratio: clampRatio(Number(one(raw.r) ?? DEFAULT_RATIO)) };
  }

  return { tabs, active, split };
}

/** One tab's own single-page URL — what "open this on its own" navigates to. */
export function tabHref(tab: Tab): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(tab.params)) sp.set(k, v);
  const q = sp.toString();
  return q ? `${tab.path}?${q}` : tab.path;
}
