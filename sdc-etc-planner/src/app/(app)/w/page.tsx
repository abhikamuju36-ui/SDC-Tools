import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { PaneView } from "@/components/PaneView";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { decodeWorkspace, tabHref, tabLabel, type RawParams } from "@/lib/workspace";
import { pairingRefusal, splitRoute } from "@/lib/split-view";

// ── /w — the workspace: browser-style tabs over the Reports App ──────────────
//
// Everything about WHY this is one route with a namespaced URL rather than iframes or
// a client-side cache is in lib/workspace.ts and lib/split-view.ts. What this file adds
// is the render: decode the URL, render the VISIBLE tabs' own view components on the
// server, and hand them to the client shell that draws the strip and the divider.
//
// ── What this route deliberately does NOT do ────────────────────────────────
//
// No auth() call, no permission check, no data loading of its own. Each tab's view is
// the page's own body and still starts with its own requirePagePermission(), so
// authorization stays server-enforced per tab and cannot be widened by being rendered
// here — see PaneView's note. The (app) layout above still supplies the sidebar,
// RealtimeProvider, LiveRefresh and the toast host: ONE of each, shared by every tab,
// which is the whole argument for a single document. One SSE connection, one heartbeat,
// one refresh pipeline, one autosave client, however many tabs are open.
//
// ── Only the visible tabs are rendered ──────────────────────────────────────
//
// One view when not split, two when split — never all eight. WorkspaceShell's header
// carries the reasoning and what it costs the user; the short version is that /w is a
// dynamic route whose render runs each rendered tab's data loads, and Monthly ETC alone
// is ~3s.

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const ws = decodeWorkspace(await searchParams);

  // ── One tab is not a workspace ─────────────────────────────────────────────
  //
  // Same reasoning as /split redirecting a one-pane URL to that pane's own route: the
  // app's twelve routes keep working as themselves, deep links and bookmarks keep
  // resolving, and the SDC Tools shell's tiles keep working. /w earns its URL once
  // there is something a single route cannot express — a second tab, or a split.
  //
  // Note this is NOT the empty case: zero tabs renders the shell with an empty strip,
  // because redirecting that would make "/w" itself unreachable.
  if (ws.tabs.length === 1 && !ws.split) redirect(tabHref(ws.tabs[0]));

  const visible = ws.split ? [ws.split.left, ws.split.right] : ws.tabs.length ? [ws.active] : [];

  // ── The one pairing this route refuses ────────────────────────────────────
  //
  // Monthly ETC in both panes of the split. lib/split-view.ts's `exclusive` flag carries
  // the whole reason (module-scope autosave state keyed by a field name containing no
  // month, so two grids share one baseline and can post into each other's month).
  // Enforced HERE as well as in the picker, because the picker is only one way in: a
  // hand-edited URL, an old bookmark or a shared link all arrive straight at this route,
  // and the guard has to be where the render is.
  const clash =
    ws.split != null
      ? pairingRefusal(ws.tabs[ws.split.right]?.path ?? "", ws.tabs[ws.split.left]?.path)
      : null;

  const panes: Record<number, React.ReactNode> = {};
  for (const id of visible) {
    const tab = ws.tabs[id];
    if (!tab) continue;
    // The refused pane shows the reason instead of the grid, rather than being silently
    // dropped: the URL asked for something specific, and a pane that just vanishes reads
    // as a bug. The other pane is unaffected and fully usable.
    if (clash && ws.split && id === ws.split.right) {
      const label = splitRoute(tab.path)?.label ?? tabLabel(tab);
      panes[id] = (
        <div className="p-6">
          <EmptyState
            title={`${label} is already open in the other pane`}
            message={
              `${label} can only be shown once at a time — its unsaved-edit tracking is shared across the page, ` +
              `so two copies could save over each other. Pick a different tab for this side of the split, or exit ` +
              `the split to go back to one full-width view.`
            }
          />
        </div>
      );
      continue;
    }
    // Rendered as siblings, so React streams them independently — a slow live Total ETO
    // call in one pane does not hold up the other pane's first paint.
    panes[id] = <PaneView key={id} pane={tab} />;
  }

  return <WorkspaceShell ws={ws} panes={panes} />;
}
