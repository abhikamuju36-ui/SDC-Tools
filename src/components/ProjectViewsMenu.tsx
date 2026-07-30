"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { TOOLBAR_BTN, TOOLBAR_BTN_ACTIVE, TOOLBAR_BTN_NEUTRAL } from "@/components/ui/classnames";
import {
  type SharedView,
  type ViewConfig,
  publishView,
  deleteSharedView,
  setTeamDefault,
  deleteTeamDefault,
} from "@/lib/saved-views-actions";

// "Views ▾" for the Projects grid — ported from the Scheduler's shared
// column-views. A view snapshots the grid's URL state (which section columns
// show, hidden info columns, sort, and the Customer/Type/Status/Billable
// filters) plus the client-side Grid Size and Actuals toggle. Three tiers:
//   • Team Default — one pinned view for everybody (server-side).
//   • Shared — named views anyone published, with the owner's name (server-side).
//   • My views — private to this browser (localStorage); ★ promotes one to Shared.
const MY_VIEWS_KEY = "quoted-my-views";
const GRID_ROW_KEY = "quoted-grid-row-py";
const GRID_COL_KEY = "quoted-grid-col-px";
const ACTUALS_KEY = "quoted-show-actuals";
// The exact set of /quoted query params a view captures (columns + filters).
const VIEW_PARAMS = ["cols", "hide", "sort", "dir", "customers", "types", "statuses", "billables"] as const;

type MyViews = Record<string, ViewConfig>;

function readMyViews(): MyViews {
  try {
    const raw = window.localStorage.getItem(MY_VIEWS_KEY);
    return raw ? (JSON.parse(raw) as MyViews) : {};
  } catch {
    return {};
  }
}
function writeMyViews(v: MyViews) {
  window.localStorage.setItem(MY_VIEWS_KEY, JSON.stringify(v));
}

// Snapshot the CURRENT grid state into a ViewConfig — URL params + the two
// client-side prefs (Grid Size, Actuals) that live in localStorage.
function snapshotView(): ViewConfig {
  const params: Record<string, string> = {};
  const sp = new URLSearchParams(window.location.search);
  for (const k of VIEW_PARAMS) {
    const val = sp.get(k);
    if (val !== null) params[k] = val;
  }
  const rowRaw = window.localStorage.getItem(GRID_ROW_KEY);
  const colRaw = window.localStorage.getItem(GRID_COL_KEY);
  const grid =
    rowRaw !== null || colRaw !== null
      ? { ...(rowRaw !== null ? { rowPy: Number(rowRaw) } : {}), ...(colRaw !== null ? { colPx: Number(colRaw) } : {}) }
      : null;
  const actualsRaw = window.localStorage.getItem(ACTUALS_KEY);
  const actuals = actualsRaw === null ? undefined : actualsRaw === "1";
  return { params, grid, actuals };
}

// Apply a view: restore the client prefs into localStorage, then hard-navigate
// to /quoted with the saved params so ProjectsDisplayMenu re-initialises from
// localStorage on mount (it restores density there, and reads the actuals flag
// straight from storage). The two separate controls this used to name were
// folded into that one menu when the toolbar was bucketed.
function applyView(name: string, config: ViewConfig) {
  if (config.grid?.rowPy != null) window.localStorage.setItem(GRID_ROW_KEY, String(config.grid.rowPy));
  if (config.grid?.colPx != null) window.localStorage.setItem(GRID_COL_KEY, String(config.grid.colPx));
  if (config.actuals !== undefined) window.localStorage.setItem(ACTUALS_KEY, config.actuals ? "1" : "0");
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(config.params)) sp.set(k, v);
  sp.set("view", name); // label only — the page ignores it for data
  window.location.assign(`/quoted?${sp.toString()}`);
}

export function ProjectViewsMenu({
  sharedViews,
  teamDefault,
}: {
  sharedViews: SharedView[];
  teamDefault: SharedView | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [mine, setMine] = useState<MyViews>({});
  const [busy, setBusy] = useState(false);
  const activeName = searchParams.get("view");

  useEffect(() => {
    setMine(readMyViews());
  }, []);

  // Click-outside-to-close, same pattern as the other toolbar dropdowns.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (detailsRef.current?.open && !detailsRef.current.contains(e.target as Node)) detailsRef.current.open = false;
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const close = () => {
    if (detailsRef.current) detailsRef.current.open = false;
  };

  function handleSaveMine() {
    const name = window.prompt("Name this view — it saves the visible columns, filters, sort, grid size and Actuals toggle. It stays private to you until you ★ share it.");
    if (!name || !name.trim()) return;
    const next = { ...readMyViews(), [name.trim()]: snapshotView() };
    writeMyViews(next);
    setMine(next);
    toast(`Saved view “${name.trim()}”`);
    close();
  }

  function handleDeleteMine(name: string) {
    const next = { ...readMyViews() };
    delete next[name];
    writeMyViews(next);
    setMine(next);
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : label, "error");
    } finally {
      setBusy(false);
    }
  }

  function handlePublish(name: string, config: ViewConfig) {
    void run("Couldn't share this view.", async () => {
      await publishView(name, config);
      // Move it out of My views (it now lives in Shared), like the Scheduler.
      handleDeleteMine(name);
      toast(`Shared “${name}” with the team`);
    });
  }

  const sec = (label: string) => (
    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sdc-gray-400">{label}</div>
  );
  const rowBtn =
    "flex-1 truncate rounded px-2 py-1 text-left text-xs hover:bg-sdc-gray-100";
  const iconBtn = "shrink-0 rounded px-1.5 text-[11px] text-sdc-gray-400 hover:bg-sdc-gray-100 hover:text-sdc-navy";

  const myNames = Object.keys(mine).sort((a, b) => a.localeCompare(b));

  return (
    <details ref={detailsRef} className="group relative inline-block">
      <summary className={`${TOOLBAR_BTN} ${activeName ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN_NEUTRAL}`}>
        {activeName ? `View: ${activeName}` : "Views"}
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 opacity-70 transition-transform duration-150 group-open:rotate-180">
          <path d="M3.5 6 L8 10.5 L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute left-0 top-full z-30 mt-2 w-64 rounded-lg border border-sdc-border bg-white py-1 shadow-lg">
        {teamDefault && (
          <div className="col-view-row flex items-center gap-1 px-2">
            <button
              type="button"
              onClick={() => applyView("Team Default", teamDefault.config)}
              className="flex-1 truncate rounded border-y-2 border-sdc-blue-100 px-2 py-1 text-left text-xs font-semibold text-sdc-navy hover:bg-sdc-blue-light"
            >
              Team Default
            </button>
            <button type="button" title="Clear the team default (affects everyone)" className={iconBtn} disabled={busy} onClick={() => run("Couldn't clear the default.", deleteTeamDefault)}>
              ✕
            </button>
          </div>
        )}

        {sharedViews.length > 0 && sec("Shared")}
        {sharedViews.map((v) => (
          <div key={v.name} className="col-view-row flex items-center gap-1 px-2">
            <button type="button" onClick={() => applyView(v.name, v.config)} className={rowBtn}>
              {v.name}
              {v.owner ? <span className="text-[10px] text-sdc-gray-400"> · {v.owner}</span> : null}
            </button>
            <button type="button" title="Delete this shared view (affects everyone)" className={iconBtn} disabled={busy} onClick={() => {
              if (window.confirm(`Delete shared view “${v.name}”? This removes it for everyone.`)) run("Couldn't delete the view.", () => deleteSharedView(v.name));
            }}>
              ✕
            </button>
          </div>
        ))}

        {sec("My views")}
        {myNames.length ? (
          myNames.map((name) => (
            <div key={name} className="col-view-row flex items-center gap-1 px-2">
              <button type="button" onClick={() => applyView(name, mine[name])} className={rowBtn}>
                {name}
              </button>
              <button type="button" title="Share this view with everyone" className={iconBtn} disabled={busy} onClick={() => handlePublish(name, mine[name])}>
                ★
              </button>
              <button type="button" title="Delete this view" className={iconBtn} onClick={() => handleDeleteMine(name)}>
                ✕
              </button>
            </div>
          ))
        ) : (
          <div className="px-3 pb-1 text-xs text-sdc-gray-400">None yet.</div>
        )}

        <div className="my-1 border-t border-sdc-border-soft" />
        <button type="button" onClick={handleSaveMine} className="block w-full px-3 py-1.5 text-left text-xs font-semibold text-sdc-navy hover:bg-sdc-gray-100">
          + Save current as view…
        </button>
        <button type="button" disabled={busy} onClick={() => run("Couldn't set the default.", async () => { await setTeamDefault(snapshotView()); toast("Set as Team Default"); close(); })} className="block w-full px-3 py-1.5 text-left text-xs text-sdc-navy hover:bg-sdc-gray-100">
          Set current as Team Default
        </button>
      </div>
    </details>
  );
}
