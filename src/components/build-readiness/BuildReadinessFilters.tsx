"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import type { BuildReadinessFilters, JobSnapshotRow, ReadinessBand } from "@/lib/build-readiness-types";
import {
  listBuildReadinessViews,
  publishBuildReadinessView,
  deleteBuildReadinessSharedView,
  setBuildReadinessTeamDefault,
  deleteBuildReadinessTeamDefault,
  type BuildReadinessViewConfig,
  type BuildReadinessSharedView,
} from "@/lib/build-readiness-views-actions";

const MY_VIEWS_KEY = "build-readiness-my-views";
type MyViews = Record<string, BuildReadinessViewConfig>;

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

const READINESS_OPTIONS: { value: ReadinessBand; label: string }[] = [
  { value: "green", label: "Green — ready" },
  { value: "yellow", label: "Yellow — at risk" },
  { value: "red", label: "Red — blocked" },
  { value: "grey", label: "Grey — no BOM" },
];

function useClickOutside(ref: React.RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ref]);
}

function MultiSelect({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useClickOutside(ref);
  const active = value.length > 0;
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <details ref={ref} className="relative">
      <summary className={`flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium ${active ? "border-sdc-blue bg-sdc-blue-light text-sdc-blue-dark" : "border-sdc-border bg-white text-sdc-navy hover:bg-sdc-blue-light"}`}>
        {label}
        {active && <span className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-sdc-blue px-1 text-label font-bold text-white tabular-nums">{value.length}</span>}
      </summary>
      <div className="absolute left-0 z-20 mt-1 max-h-64 w-56 overflow-auto styled-scrollbar rounded-lg border border-sdc-border bg-white p-1.5 shadow-lg">
        {options.length === 0 && <div className="px-2 py-1 text-xs text-sdc-gray-400">None available</div>}
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-sdc-navy hover:bg-sdc-blue-light">
            <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
            <span className="truncate">{o.label}</span>
          </label>
        ))}
        {active && (
          <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-md border border-sdc-border bg-white px-2 py-1 text-note font-medium text-sdc-navy hover:bg-sdc-blue-light">
            Clear
          </button>
        )}
      </div>
    </details>
  );
}

function ViewsMenu({
  filters,
  setFilters,
  initialViews,
}: {
  filters: BuildReadinessFilters;
  setFilters: (f: BuildReadinessFilters) => void;
  initialViews: { default: BuildReadinessSharedView | null; shared: BuildReadinessSharedView[] };
}) {
  const { toast } = useToast();
  const ref = useRef<HTMLDetailsElement>(null);
  useClickOutside(ref);
  const [mine, setMine] = useState<MyViews>({});
  const [shared, setShared] = useState<BuildReadinessSharedView[]>(initialViews.shared);
  const [teamDefault, setTeamDefault] = useState<BuildReadinessSharedView | null>(initialViews.default);
  const [busy, setBusy] = useState(false);

  // "My views" only ever live in this browser's localStorage — the server has
  // no way to include them in `initialViews`, so this is the one piece that
  // still needs a mount effect (matching ProjectViewsMenu.tsx's own pattern).
  useEffect(() => {
    setMine(readMyViews());
  }, []);

  const close = () => {
    if (ref.current) ref.current.open = false;
  };

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      const v = await listBuildReadinessViews();
      setShared(v.shared);
      setTeamDefault(v.default);
    } catch (e) {
      toast(e instanceof Error ? e.message : label, "error");
    } finally {
      setBusy(false);
    }
  }

  function handleSaveMine() {
    const name = window.prompt("Name this view — it saves the current filters.");
    if (!name || !name.trim()) return;
    const next = { ...readMyViews(), [name.trim()]: { filters } };
    writeMyViews(next);
    setMine(next);
    toast(`Saved view "${name.trim()}"`);
    close();
  }
  function handleDeleteMine(name: string) {
    const next = { ...readMyViews() };
    delete next[name];
    writeMyViews(next);
    setMine(next);
  }
  function handlePublish(name: string, config: BuildReadinessViewConfig) {
    void run("Couldn't share this view.", async () => {
      await publishBuildReadinessView(name, config);
      handleDeleteMine(name);
      toast(`Shared "${name}" with the team`);
    });
  }

  const myNames = Object.keys(mine).sort((a, b) => a.localeCompare(b));
  const rowBtn = "flex-1 truncate rounded px-2 py-1 text-left text-xs hover:bg-sdc-gray-100";
  const iconBtn = "shrink-0 rounded px-1.5 text-note text-sdc-gray-400 hover:bg-sdc-gray-100 hover:text-sdc-navy";
  const sec = (label: string) => <div className="px-3 pt-2 pb-1 text-label font-semibold uppercase tracking-wider text-sdc-gray-400">{label}</div>;

  return (
    <details ref={ref} className="group relative inline-block">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-sdc-border bg-white px-2.5 text-xs font-medium text-sdc-navy hover:bg-sdc-blue-light">
        Views
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 opacity-70 group-open:rotate-180">
          <path d="M3.5 6 L8 10.5 L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute left-0 top-full z-30 mt-2 w-64 rounded-lg border border-sdc-border bg-white py-1 shadow-lg">
        {teamDefault && (
          <div className="flex items-center gap-1 px-2">
            <button type="button" onClick={() => { setFilters(teamDefault.config.filters); close(); }} className="flex-1 truncate rounded border-y-2 border-sdc-blue-100 px-2 py-1 text-left text-xs font-semibold text-sdc-navy hover:bg-sdc-blue-light">
              Team Default
            </button>
            <button type="button" title="Clear the team default (affects everyone)" className={iconBtn} disabled={busy} onClick={() => run("Couldn't clear the default.", deleteBuildReadinessTeamDefault)}>✕</button>
          </div>
        )}
        {shared.length > 0 && sec("Shared")}
        {shared.map((v) => (
          <div key={v.name} className="flex items-center gap-1 px-2">
            <button type="button" onClick={() => { setFilters(v.config.filters); close(); }} className={rowBtn}>
              {v.name}
              {v.owner ? <span className="text-label text-sdc-gray-400"> · {v.owner}</span> : null}
            </button>
            <button type="button" title="Delete this shared view (affects everyone)" className={iconBtn} disabled={busy} onClick={() => {
              if (window.confirm(`Delete shared view "${v.name}"? This removes it for everyone.`)) run("Couldn't delete the view.", () => deleteBuildReadinessSharedView(v.name));
            }}>✕</button>
          </div>
        ))}
        {sec("My views")}
        {myNames.length ? (
          myNames.map((name) => (
            <div key={name} className="flex items-center gap-1 px-2">
              <button type="button" onClick={() => { setFilters(mine[name].filters); close(); }} className={rowBtn}>{name}</button>
              <button type="button" title="Share this view with everyone" className={iconBtn} disabled={busy} onClick={() => handlePublish(name, mine[name])}>★</button>
              <button type="button" title="Delete this view" className={iconBtn} onClick={() => handleDeleteMine(name)}>✕</button>
            </div>
          ))
        ) : (
          <div className="px-3 pb-1 text-xs text-sdc-gray-400">None yet.</div>
        )}
        <div className="my-1 border-t border-sdc-border-soft" />
        <button type="button" onClick={handleSaveMine} className="block w-full px-3 py-1.5 text-left text-xs font-semibold text-sdc-navy hover:bg-sdc-gray-100">+ Save current as view…</button>
        <button type="button" disabled={busy} onClick={() => run("Couldn't set the default.", async () => { await setBuildReadinessTeamDefault({ filters }); toast("Set as Team Default"); close(); })} className="block w-full px-3 py-1.5 text-left text-xs text-sdc-navy hover:bg-sdc-gray-100">
          Set current as Team Default
        </button>
      </div>
    </details>
  );
}

export function BuildReadinessFilterBar({
  filters,
  setFilters,
  jobs,
  initialViews,
}: {
  filters: BuildReadinessFilters;
  setFilters: (f: BuildReadinessFilters) => void;
  jobs: JobSnapshotRow[];
  initialViews: { default: BuildReadinessSharedView | null; shared: BuildReadinessSharedView[] };
}) {
  const customers = useMemo(() => [...new Set(jobs.map((j) => j.customer).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)), [jobs]);
  const suppliers = useMemo(() => {
    const s = new Set<string>();
    for (const j of jobs) for (const v of j.detail.vendors) s.add(v.name);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [jobs]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sdc-border bg-white px-3 py-2.5 shadow-sm">
      <input
        type="search"
        value={filters.query ?? ""}
        onChange={(e) => setFilters({ ...filters, query: e.target.value || undefined })}
        placeholder="Search job # or name…"
        className="h-8 w-48 rounded-md border border-sdc-border bg-white px-2 text-xs outline-none focus:border-sdc-blue"
      />
      <input
        type="search"
        value={filters.assemblyQuery ?? ""}
        onChange={(e) => setFilters({ ...filters, assemblyQuery: e.target.value || undefined })}
        placeholder="Search assembly…"
        className="h-8 w-44 rounded-md border border-sdc-border bg-white px-2 text-xs outline-none focus:border-sdc-blue"
      />
      <MultiSelect label="Customer" options={customers.map((c) => ({ value: c, label: c }))} value={filters.customers ?? []} onChange={(v) => setFilters({ ...filters, customers: v.length ? v : undefined })} />
      <MultiSelect label="Supplier" options={suppliers.map((s) => ({ value: s, label: s }))} value={filters.suppliers ?? []} onChange={(v) => setFilters({ ...filters, suppliers: v.length ? v : undefined })} />
      <MultiSelect label="Readiness" options={READINESS_OPTIONS} value={filters.statuses ?? []} onChange={(v) => setFilters({ ...filters, statuses: v.length ? v : undefined })} />
      {(filters.query || filters.assemblyQuery || filters.customers?.length || filters.suppliers?.length || filters.statuses?.length) && (
        <button type="button" onClick={() => setFilters({})} className="rounded-md border border-sdc-border bg-white px-2.5 py-1 text-xs font-medium text-sdc-navy hover:bg-sdc-blue-light">
          Clear filters
        </button>
      )}
      <div className="ml-auto">
        <ViewsMenu filters={filters} setFilters={setFilters} initialViews={initialViews} />
      </div>
    </div>
  );
}
