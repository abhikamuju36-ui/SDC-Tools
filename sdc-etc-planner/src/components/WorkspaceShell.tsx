"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceTabBar } from "@/components/WorkspaceTabBar";
import { DEFAULT_RATIO, MIN_PANE_PX, clampRatio, ratioBounds } from "@/lib/split-view";
import { activateTab, encodeWorkspace, exitSplit, tabLabel, workspaceHref, type Workspace } from "@/lib/workspace";

// ── The workspace's chrome: the tab bar, and the split beneath it ────────────
//
// Layout and interaction only. Every tab's CONTENT is rendered on the server and handed
// in as children, so nothing about a drag, a focus change or a keyboard shortcut can
// re-render a page's body.
//
// ── What is rendered, and what that costs ───────────────────────────────────
//
// Only what is VISIBLE: the active tab, or the two tabs in the split. Not every open
// tab. The alternative — mounting all eight and toggling CSS visibility — is the only
// way to make a tab switch truly instant and preserve live client state across it, and
// it was rejected on cost: /w is a dynamic route whose render runs each mounted tab's
// data loads, so eight open tabs would re-run Monthly ETC's queries (~3s) and Job Hour
// Details' live Total ETO call on EVERY navigation, for seven tabs nobody is looking at.
//
// So a tab switch is a server navigation, and the consequences are honest rather than
// hidden:
//
//   * A tab's CONTEXT survives — its month, job, filters and sort all live in the URL
//     under its own `t<i>.` namespace, so switching away and back returns you to the
//     same view of the same data. That is the part that matters and it is exact.
//   * Its SCROLL POSITION survives, restored per tab by ScrollMemory below.
//   * Transient client state does NOT survive: an open dropdown, a half-typed filter,
//     an expanded drill-down. Unsaved ETC cell edits are the one case where that would
//     be destructive, and they are already protected — etc-dirty-tracker's navigation
//     guard fires on a tab switch exactly as it does on a sidebar click, because both
//     are ordinary router navigations.
function ScrollMemory({ scopeKey, children }: { scopeKey: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  // sessionStorage, not the URL: a scroll offset is not something to put in a link
  // somebody shares, and it is per-window by nature. Keyed by the tab's route + params
  // so returning to the same view of the same data lands where you left it, while
  // changing the month legitimately starts at the top.
  const key = `sdc.ws.scroll:${scopeKey}`;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      const saved = Number(sessionStorage.getItem(key));
      // Restored in a layout effect so it happens before paint — a scroll set in a
      // plain effect is visible as a jump from the top.
      if (Number.isFinite(saved) && saved > 0) el.scrollTop = saved;
    } catch {
      // Private mode, or storage disabled. Starting at the top is a fine outcome.
    }

    let raf = 0;
    const onScroll = () => {
      // One write per frame at most: this fires on every scroll event of a long
      // Monthly ETC grid.
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        try {
          sessionStorage.setItem(key, String(el.scrollTop));
        } catch {
          /* see above */
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [key]);

  // overflow-auto both ways: dense pages scroll horizontally in here too, and
  // ScrollHandoff (mounted once in AppShell, above this) keeps nested table scrolling
  // working because it listens at the document level.
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-auto bg-background">
      {children}
    </div>
  );
}

export function WorkspaceShell({
  ws,
  panes,
}: {
  /** Decoded on the server, so the first paint is already the right layout — no post-hydration snap. */
  ws: Workspace;
  /**
   * The rendered content for the visible tabs, keyed by tab index. One entry when not
   * split, two when split — the route decides, so this component never has to know
   * which views exist.
   */
  panes: Record<number, React.ReactNode>;
}) {
  const router = useRouter();
  const rowRef = useRef<HTMLDivElement | null>(null);

  const [ratio, setRatio] = useState(() => clampRatio(ws.split?.ratio ?? DEFAULT_RATIO));
  const [dragging, setDragging] = useState(false);

  // ── Responsive collapse ──────────────────────────────────────────────────
  //
  // Measured, not guessed from a media query: the panes live inside <main>, whose width
  // is the viewport minus a sidebar the user can collapse or drag. A viewport
  // breakpoint would be wrong by exactly the sidebar's width — the difference between
  // two readable panes and two unreadable ones. `null` until measured, so the server's
  // own two-pane markup renders first and nothing collapses-then-expands on hydration.
  const [available, setAvailable] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Why a divider drag must never touch the router ──────────────────────
  //
  // The ratio lives in the URL so a reload restores the layout. router.replace would
  // write it correctly and re-run /w's render — both panes' data loads — because
  // somebody nudged a divider two pixels. history.replaceState updates the address bar
  // WITHOUT notifying the router: no navigation, no RSC request, no refetch. This is
  // the documented pattern for search-param state that is not a navigation, and it is
  // the same mechanism SplitViewShell uses.
  const syncRatio = useCallback(
    (r: number) => {
      if (typeof window === "undefined" || !ws.split) return;
      const next: Workspace = { ...ws, split: { ...ws.split, ratio: clampRatio(r) } };
      window.history.replaceState(null, "", `/w?${encodeWorkspace(next)}`);
    },
    [ws],
  );

  // Ctrl+\ leaves the split, keeping the pane you were in — the toggle's "off"
  // direction. Turning it ON needs a target tab, which a shortcut cannot guess; that
  // is what the Split View picker is for.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "\\" || !ws.split) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      router.push(workspaceHref(exitSplit(ws, ws.active)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, ws]);

  const bar = <WorkspaceTabBar ws={ws} />;

  // ── No tabs ──────────────────────────────────────────────────────────────
  if (ws.tabs.length === 0) {
    return (
      <div className="flex min-h-[var(--app-vh)] flex-col">
        {bar}
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-body text-sdc-muted">
            No tabs open. Pick a page from the sidebar, or use{" "}
            <span className="font-semibold text-sdc-gray-700">+</span> above.
          </p>
        </div>
      </div>
    );
  }

  // ── One tab ──────────────────────────────────────────────────────────────
  if (!ws.split) {
    return (
      <div className="flex min-h-[var(--app-vh)] flex-col">
        {bar}
        {/* No pane header: with one tab, the tab strip already names the page, and a
            second title bar under it would be chrome competing with the page's own. */}
        <ScrollMemory scopeKey={scopeKeyFor(ws, ws.active)}>{panes[ws.active]}</ScrollMemory>
      </div>
    );
  }

  const bounds = available == null ? null : ratioBounds(available);
  // Too narrow for two panes: show only the active one, full width, and say so. The
  // split is NOT closed — the URL still holds both tabs, so widening the window (or
  // collapsing the sidebar) brings the other one straight back. Requirement: never
  // create unreadable 200px-wide Monthly ETC tables.
  const collapsed = available != null && bounds == null;
  const effectiveRatio = bounds ? Math.min(bounds.max, Math.max(bounds.min, ratio)) : ratio;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (collapsed) return;
    e.preventDefault();
    const row = rowRef.current;
    if (!row) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);

    const rect = row.getBoundingClientRect();
    let last = ratio;
    const move = (ev: PointerEvent) => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      const b = ratioBounds(rect.width);
      last = b ? Math.min(b.max, Math.max(b.min, Math.round(pct))) : clampRatio(pct);
      // Local state only while dragging — the URL is written once, on release, so a
      // drag produces one history.replaceState rather than sixty.
      setRatio(last);
    };
    const up = (ev: PointerEvent) => {
      handle.releasePointerCapture?.(ev.pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      setDragging(false);
      syncRatio(last);
    };
    // setPointerCapture means the drag keeps tracking when the cursor crosses into a
    // pane or leaves the window. The failure mode of mousemove-on-document is a
    // divider that sticks to the cursor after release.
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  const nudge = (n: number) => {
    const b = bounds ?? { min: 20, max: 80 };
    const r = Math.min(b.max, Math.max(b.min, n));
    setRatio(r);
    syncRatio(r);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    const b = bounds ?? { min: 20, max: 80 };
    const at = (n: number) => {
      e.preventDefault();
      nudge(n);
    };
    if (e.key === "ArrowLeft") at(effectiveRatio - step);
    else if (e.key === "ArrowRight") at(effectiveRatio + step);
    else if (e.key === "Home") at(b.min);
    else if (e.key === "End") at(b.max);
    else if (e.key === "Enter" || e.key === " ") at(DEFAULT_RATIO);
  };

  const { left, right } = ws.split;

  return (
    <div className="flex min-h-[var(--app-vh)] flex-col">
      {bar}
      <div
        ref={rowRef}
        className="flex min-h-0 flex-1 items-stretch"
        style={dragging ? { userSelect: "none", cursor: "col-resize" } : undefined}
      >
        <SplitPane
          ws={ws}
          id={left}
          hidden={collapsed && ws.active !== left}
          width={collapsed ? "100%" : `${effectiveRatio}%`}
          collapsed={collapsed}
        >
          {panes[left]}
        </SplitPane>

        {!collapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the split. Arrow keys adjust, Enter resets to an even split."
            aria-valuenow={effectiveRatio}
            aria-valuemin={bounds?.min ?? 20}
            aria-valuemax={bounds?.max ?? 80}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onDoubleClick={() => nudge(DEFAULT_RATIO)}
            onKeyDown={onKeyDown}
            title="Drag to resize · double-click for an even split"
            // 9px of hit area around a 1px rule: easy to grab, without a fat visible
            // seam. `group` drives the inner rule's hover colour, so the target and
            // the thing that looks like the target are the same element.
            className={`group relative z-10 w-[9px] shrink-0 cursor-col-resize touch-none focus:outline-none ${
              dragging ? "bg-sdc-blue/10" : "hover:bg-sdc-blue/5"
            }`}
            style={{ touchAction: "none" }}
          >
            <span
              aria-hidden
              className={`motion-interactive pointer-events-none absolute inset-y-0 left-1/2 -ml-px w-0.5 ${
                dragging ? "bg-sdc-blue" : "bg-sdc-border group-hover:bg-sdc-blue/60 group-focus:bg-sdc-blue"
              }`}
            />
          </div>
        )}

        <SplitPane
          ws={ws}
          id={right}
          hidden={collapsed && ws.active !== right}
          width={collapsed ? "100%" : `${100 - effectiveRatio}%`}
          collapsed={collapsed}
        >
          {panes[right]}
        </SplitPane>
      </div>
    </div>
  );
}

/** A tab's scroll identity: its route AND its params, so a new month starts at the top. */
function scopeKeyFor(ws: Workspace, id: number): string {
  const tab = ws.tabs[id];
  if (!tab) return String(id);
  const sp = new URLSearchParams(tab.params);
  sp.sort(); // stable regardless of the order the params were written in
  return `${tab.path}?${sp.toString()}`;
}

function SplitPane({
  ws,
  id,
  hidden,
  width,
  collapsed,
  children,
}: {
  ws: Workspace;
  id: number;
  hidden: boolean;
  width: string;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const tab = ws.tabs[id];
  const isActive = ws.active === id;
  const label = tab ? tabLabel(tab) : "";

  if (hidden || !tab) return null;

  const activate = () => {
    if (!isActive) router.push(workspaceHref(activateTab(ws, id)));
  };

  return (
    // onFocusCapture alongside the mousedown: tabbing into a pane makes it active too,
    // so a keyboard user is never navigating with the sidebar into a pane they cannot
    // tell they are in. Capture phase, because the focus lands on a descendant.
    <section
      onMouseDown={activate}
      onFocusCapture={activate}
      aria-label={`${label} pane`}
      // min-w-0 is what lets a dense page scroll horizontally INSIDE its pane rather
      // than forcing the pane wider than its share, which would push the divider off
      // the ratio the user set.
      className="flex min-w-0 flex-col"
      style={{ width, minWidth: collapsed ? undefined : MIN_PANE_PX }}
    >
      {/* Thin (h-7, one line): two of these are on screen at once, above pages that
          already have their own titles and toolbars. The tab strip above names both
          pages, so this bar carries only what the strip cannot — WHICH pane the
          sidebar will open into. */}
      <header
        className={`flex h-7 shrink-0 items-center gap-1.5 border-b px-2 ${
          isActive ? "border-sdc-blue/40 bg-sdc-blue-light/40" : "border-sdc-border bg-sdc-gray-50"
        }`}
      >
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-sdc-blue" : "bg-sdc-gray-300"}`} />
        <span className={`truncate text-label font-semibold ${isActive ? "text-sdc-navy" : "text-sdc-gray-600"}`}>
          {label}
        </span>
        {isActive && (
          // Says WHY the highlight matters, which an active-pane outline on its own
          // never manages to communicate.
          <span className="hidden whitespace-nowrap text-micro text-sdc-blue-dark sm:inline">· sidebar opens here</span>
        )}
      </header>
      {/* Each pane its own scroll container: scrolling Monthly ETC on the left must not
          move Job Hour Details on the right. */}
      <ScrollMemory scopeKey={scopeKeyFor(ws, id)}>{children}</ScrollMemory>
    </section>
  );
}
