"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  computeJobCost,
  isUtilityJob,
  type CostRates,
  type JobCostComputed,
  type JobCostRow,
  type JobHourAllocation,
  type YearRateOverrides,
} from "@/lib/job-cost";
import type { LiveEtcReference } from "@/lib/job-cost-source";
import { saveDefaultRate, saveYearRateOverride, clearAllYearRateOverrides, saveJobHourAllocation, clearJobHourAllocation } from "@/lib/job-cost-actions";
import { exportJobCostRows } from "@/lib/export/job-cost-export";
import { card, BUTTON_SECONDARY, TOOLBAR_BTN, TOOLBAR_BTN_ACTIVE, TOOLBAR_BTN_NEUTRAL, INPUT, TABLE_GRID, TABLE_HEADER_ROW, GRID_SCROLLER, TABLE_ROW_HOVER } from "@/components/ui/classnames";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { JobCostRateMatrixModal } from "@/components/JobCostRateMatrixModal";
import { JobCostHourAllocationModal } from "@/components/JobCostHourAllocationModal";

type ColKey =
  | "customerName" | "actualHours" | "engineeringHours" | "shopHours" | "otherHours"
  | "pmCost" | "mfgCost" | "laborCost" | "etcEngHours" | "etcShopHours" | "etcPartsCost"
  | "partCost" | "partInvoiced" | "percentComplete" | "salesPrice" | "startDate" | "completeDate"
  | "profit" | "margin";

const COLS: { key: ColKey; label: string; group: "identity" | "actuals" | "etc" | "financial" }[] = [
  { key: "customerName", label: "Customer", group: "identity" },
  { key: "actualHours", label: "Act Hrs", group: "actuals" },
  { key: "engineeringHours", label: "Eng Hrs", group: "actuals" },
  { key: "shopHours", label: "Shop Hrs", group: "actuals" },
  { key: "otherHours", label: "Other Hrs", group: "actuals" },
  { key: "pmCost", label: "PM $", group: "actuals" },
  { key: "mfgCost", label: "Mfg $", group: "actuals" },
  { key: "laborCost", label: "Labor $", group: "actuals" },
  { key: "etcEngHours", label: "ETC Eng", group: "etc" },
  { key: "etcShopHours", label: "ETC Shop", group: "etc" },
  { key: "etcPartsCost", label: "ETC Parts", group: "etc" },
  { key: "partCost", label: "Parts Purchased", group: "financial" },
  { key: "partInvoiced", label: "Parts Invoiced", group: "financial" },
  { key: "percentComplete", label: "% Complete", group: "financial" },
  { key: "salesPrice", label: "Sales $", group: "financial" },
  { key: "startDate", label: "Start", group: "financial" },
  { key: "completeDate", label: "Complete", group: "financial" },
  { key: "profit", label: "Profit", group: "financial" },
  { key: "margin", label: "Margin", group: "financial" },
];

const HIDDEN_COLS_KEY = "job-cost-explorer-hidden-cols";

const fmtNum = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString());
const fmtMoney = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
const fmtPct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

export function JobCostExplorer({
  rows,
  defaultRates,
  yearRateOverrides,
  hourAllocations,
  liveEtcByJobId,
  inventoryAsOf,
  etcRefreshedThru,
  partsCostAvailable,
}: {
  rows: JobCostRow[];
  defaultRates: CostRates;
  yearRateOverrides: YearRateOverrides;
  hourAllocations: Record<string, JobHourAllocation>;
  liveEtcByJobId: Record<string, LiveEtcReference>;
  inventoryAsOf: string | null;
  etcRefreshedThru: string | null;
  partsCostAvailable: boolean;
}) {
  // Optimistic local mirror of the shared server state: a modal's "Apply"
  // updates this immediately so the table recalculates with no round trip
  // (the original app's own design principle — "changing an assumption is
  // instant and needs no re-query"), while the underlying save persists in
  // the background. When another tab's edit lands, a realtime-triggered
  // refresh gives this component fresh props, and the effects below
  // reconcile local state back to the authoritative server value.
  // Set-state-during-render (not an effect) to resync when the SERVER prop
  // itself changes identity — same technique useDrillFilters.ts uses for its
  // resetKey. An effect here would apply the update one frame late, which
  // for these three is a real, if brief, "another tab's edit didn't land"
  // window rather than a cosmetic one.
  const [rates, setRates] = useState(defaultRates);
  const [seenDefaultRates, setSeenDefaultRates] = useState(defaultRates);
  if (seenDefaultRates !== defaultRates) {
    setSeenDefaultRates(defaultRates);
    setRates(defaultRates);
  }
  const [overrides, setOverrides] = useState(yearRateOverrides);
  const [seenOverrides, setSeenOverrides] = useState(yearRateOverrides);
  if (seenOverrides !== yearRateOverrides) {
    setSeenOverrides(yearRateOverrides);
    setOverrides(yearRateOverrides);
  }
  const [allocations, setAllocations] = useState(hourAllocations);
  const [seenAllocations, setSeenAllocations] = useState(hourAllocations);
  if (seenAllocations !== hourAllocations) {
    setSeenAllocations(hourAllocations);
    setAllocations(hourAllocations);
  }

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "Active" | "HeadStart" | "Complete">("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [customerFilter, setCustomerFilter] = useState("");
  const [hideUtility, setHideUtility] = useState(true);
  const [sortKey, setSortKey] = useState<ColKey | "jobId" | "jobName" | "status">("jobId");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [showLiveEtc, setShowLiveEtc] = useState(false);

  const [hiddenCols, setHiddenCols] = useState<Set<ColKey>>(new Set());
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(HIDDEN_COLS_KEY) || "[]");
      if (Array.isArray(saved)) setHiddenCols(new Set(saved));
    } catch {
      // localStorage unavailable or corrupt — start with every column shown.
    }
  }, []);
  function toggleCol(key: ColKey) {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify([...next]));
      } catch {
        // Not fatal — the picker just won't remember across visits.
      }
      return next;
    });
  }

  const [rateMatrixOpen, setRateMatrixOpen] = useState(false);
  const [allocationJobId, setAllocationJobId] = useState<string | null>(null);
  const [colPickerOpen, setColPickerOpen] = useState(false);

  const computed = useMemo<JobCostComputed[]>(
    () => rows.map((r) => computeJobCost(r, rates, overrides, allocations[r.jobId])),
    [rows, rates, overrides, allocations],
  );

  const customers = useMemo(
    () => [...new Set(computed.map((r) => r.customerName).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    [computed],
  );
  const years = useMemo(
    () => [...new Set(computed.filter((r) => r.completeDate).map((r) => r.completeDate!.slice(0, 4)))].sort((a, b) => b.localeCompare(a)),
    [computed],
  );

  const visibleRows = useMemo(() => {
    const terms = search.toLowerCase().split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    let out = computed
      .filter((r) => !(hideUtility && isUtilityJob(r.jobId)))
      .filter((r) => statusFilter === "all" || r.status === statusFilter)
      .filter((r) => yearFilter === "all" || (r.completeDate && r.completeDate.slice(0, 4) === yearFilter))
      .filter((r) => !customerFilter || r.customerName === customerFilter)
      .filter((r) => !terms.length || terms.some((t) => `${r.jobId} ${r.jobName} ${r.customerName ?? ""} ${r.status}`.toLowerCase().includes(t)));
    out = [...out].sort((a, b) => {
      const av = a[sortKey as keyof JobCostComputed];
      const bv = b[sortKey as keyof JobCostComputed];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
    return out;
  }, [computed, search, statusFilter, yearFilter, customerFilter, hideUtility, sortKey, sortDir]);

  function toggleSort(key: typeof sortKey) {
    setSortDir((d) => (sortKey === key ? ((-d) as 1 | -1) : 1));
    setSortKey(key);
  }

  async function applyDefaultRate(next: CostRates) {
    setRates(next);
    const fd = new FormData();
    fd.set("engRate", String(next.engRate));
    fd.set("shopRate", String(next.shopRate));
    fd.set("pmPct", String(next.pmPct));
    fd.set("mfgPct", String(next.mfgPct));
    await saveDefaultRate(fd);
  }
  async function applyYearOverride(year: string, partial: Partial<CostRates>) {
    setOverrides((prev) => ({ ...prev, [year]: partial }));
    const fd = new FormData();
    fd.set("year", year);
    if (partial.engRate != null) fd.set("engRate", String(partial.engRate));
    if (partial.shopRate != null) fd.set("shopRate", String(partial.shopRate));
    if (partial.pmPct != null) fd.set("pmPct", String(partial.pmPct));
    if (partial.mfgPct != null) fd.set("mfgPct", String(partial.mfgPct));
    await saveYearRateOverride(fd);
  }
  async function clearAllOverrides() {
    setOverrides({});
    await clearAllYearRateOverrides();
  }
  async function applyAllocation(jobId: string, alloc: JobHourAllocation | null) {
    setAllocations((prev) => {
      const next = { ...prev };
      if (alloc) next[jobId] = alloc;
      else delete next[jobId];
      return next;
    });
    if (alloc) await saveJobHourAllocation(jobId, alloc.eng, alloc.shop);
    else await clearJobHourAllocation(jobId);
  }

  const { toast } = useToast();
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);

  async function handleExport(format: "csv" | "xlsx") {
    if (exporting) return;
    setExporting(format);
    try {
      const visibleKeys = COLS.filter((c) => !hiddenCols.has(c.key)).map((c) => c.key);
      const { base64, fileName, mime } = await exportJobCostRows(visibleRows, visibleKeys, format);
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast(`${fileName} downloaded.`, "success");
    } catch (err) {
      toast(err instanceof Error ? `Export failed — ${err.message}` : "Export failed.", "error");
    } finally {
      setExporting(null);
    }
  }

  const totals = useMemo(() => {
    const sum = (f: keyof JobCostComputed) => visibleRows.reduce((a, r) => a + (Number(r[f]) || 0), 0);
    return {
      actualHours: sum("actualHours"), engineeringHours: sum("engineeringHours"), shopHours: sum("shopHours"), otherHours: sum("otherHours"),
      pmCost: sum("pmCost"), mfgCost: sum("mfgCost"), laborCost: sum("laborCost"),
      etcEngHours: sum("etcEngHours"), etcShopHours: sum("etcShopHours"), etcPartsCost: sum("etcPartsCost"),
      partCost: sum("partCost"), partInvoiced: sum("partInvoiced"), salesPrice: sum("salesPrice"),
      profit: visibleRows.some((r) => r.profit != null) ? sum("profit") : null,
    };
  }, [visibleRows]);

  const activeJobForAllocation = allocationJobId ? computed.find((r) => r.jobId === allocationJobId) ?? null : null;

  return (
    // Job Cost Explorer's own export-result toasts are suppressed app-wide per the
    // task's "no global side notifications from this area" — it has no critical-per-spec
    // call sites (see lib/notification-stack.ts's shouldSuppress for the bypass a
    // future critical one would need). Exports still succeed/fail identically; only the
    // global toast is silenced.
    //
    // SuppressToasts is NOT wrapped here. A component cannot supply its own
    // useToast() call — made above, in this component's OWN render scope — with a
    // Provider it renders as part of its own returned JSX: useContext resolves
    // against ANCESTORS at the point the hook actually runs, and a self-wrap is a
    // descendant of that point, not an ancestor. The wrap lives one level up, at
    // the call site in app/(app)/job-cost-explorer/page.tsx, which correctly makes
    // it an ancestor of this whole component.
    <div className="flex flex-col gap-4">
      <div className={`${card("p-4")} flex flex-col gap-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${INPUT} w-56`}
            placeholder="Search job, name, customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {(["all", "Active", "HeadStart", "Complete"] as const).map((s) => (
            <button
              key={s}
              className={`${TOOLBAR_BTN} ${statusFilter === s ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN_NEUTRAL}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? "All statuses" : s}
            </button>
          ))}
          <select className={INPUT} value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {years.length > 0 && (
            <select className={INPUT} value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
              <option value="all">All completion years</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1.5 text-sm text-sdc-navy">
            <input type="checkbox" checked={hideUtility} onChange={(e) => setHideUtility(e.target.checked)} />
            Hide utility jobs
          </label>
          <label className="flex items-center gap-1.5 text-sm text-sdc-navy" title="Show this app's live ETC total alongside the Standard Fees snapshot">
            <input type="checkbox" checked={showLiveEtc} onChange={(e) => setShowLiveEtc(e.target.checked)} />
            Show live ETC
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button className={BUTTON_SECONDARY} onClick={() => setColPickerOpen((v) => !v)}>Columns</button>
            <button className={BUTTON_SECONDARY} disabled={exporting !== null} onClick={() => handleExport("csv")}>
              {exporting === "csv" ? "Preparing…" : "Export CSV"}
            </button>
            <button className={BUTTON_SECONDARY} disabled={exporting !== null} onClick={() => handleExport("xlsx")}>
              {exporting === "xlsx" ? "Preparing…" : "Export Excel"}
            </button>
            <button className={BUTTON_SECONDARY} onClick={() => setRateMatrixOpen(true)}>Rate Matrix</button>
          </div>
        </div>
        {colPickerOpen && (
          <div className="flex flex-wrap gap-3 rounded-lg border border-sdc-border bg-sdc-gray-50 p-3">
            {COLS.map((c) => (
              <label key={c.key} className="flex items-center gap-1.5 text-xs text-sdc-navy">
                <input type="checkbox" checked={!hiddenCols.has(c.key)} onChange={() => toggleCol(c.key)} />
                {c.label}
              </label>
            ))}
          </div>
        )}
        <p className="text-note text-sdc-gray-400">
          {visibleRows.length} jobs
          {inventoryAsOf && ` · Sales/% complete as of ${inventoryAsOf}`}
          {etcRefreshedThru && ` · ETC snapshot thru ${etcRefreshedThru}`}
        </p>
        {!partsCostAvailable && (
          <p className="rounded border border-sdc-yellow bg-sdc-yellow-bg px-2 py-1 text-note text-sdc-yellow-text">
            Total ETO didn&apos;t respond in time for Parts Purchased/Invoiced — those columns show &ldquo;—&rdquo; below. Everything else on this page is unaffected; try again shortly.
          </p>
        )}
      </div>

      {visibleRows.length === 0 ? (
        <EmptyState title="No jobs match the current filters" message="Try clearing a filter or the search box." />
      ) : (
        <div className={`${GRID_SCROLLER} max-h-[calc(var(--app-vh)_-_20rem)]`}>
          <table className={`w-full text-sm ${TABLE_GRID}`}>
            <thead className="sticky top-0 z-10 bg-white">
              <tr className={TABLE_HEADER_ROW}>
                <th className="cursor-pointer px-2 py-2 text-left" onClick={() => toggleSort("jobId")}>Job Id</th>
                <th className="cursor-pointer px-2 py-2 text-left" onClick={() => toggleSort("jobName")}>Job Name</th>
                {!hiddenCols.has("customerName") && <th className="cursor-pointer px-2 py-2 text-left" onClick={() => toggleSort("customerName")}>Customer</th>}
                <th className="cursor-pointer px-2 py-2" onClick={() => toggleSort("status")}>Status</th>
                {COLS.filter((c) => c.key !== "customerName" && !hiddenCols.has(c.key)).map((c) => (
                  <th key={c.key} className="cursor-pointer px-2 py-2" onClick={() => toggleSort(c.key)}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const alloc = allocations[r.jobId];
                const live = liveEtcByJobId[r.jobId];
                return (
                  <tr key={r.jobId} className={TABLE_ROW_HOVER}>
                    <td className="px-2 py-1.5 text-left">
                      <button
                        className="font-mono text-sdc-blue-dark underline decoration-dotted"
                        title="Set a manual hour allocation for this job"
                        onClick={() => setAllocationJobId(r.jobId)}
                      >
                        {r.jobId}
                      </button>
                      {alloc && (alloc.eng.length > 0 || alloc.shop.length > 0) && (
                        <span className="ml-1 text-sdc-blue" title="Has a manual hour allocation">●</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-left">
                      <Link href={`/job-hours?jobs=${r.jobId}`} className="hover:underline" title="Open in Job Hour Details">
                        {r.jobName || "—"}
                      </Link>
                    </td>
                    {!hiddenCols.has("customerName") && <td className="px-2 py-1.5 text-left">{r.customerName || "—"}</td>}
                    <td className="px-2 py-1.5 text-center">{r.status}</td>
                    {!hiddenCols.has("actualHours") && <td className="px-2 py-1.5 text-right">{fmtNum(r.actualHours)}</td>}
                    {!hiddenCols.has("engineeringHours") && <td className="px-2 py-1.5 text-right">{fmtNum(r.engineeringHours)}</td>}
                    {!hiddenCols.has("shopHours") && <td className="px-2 py-1.5 text-right">{fmtNum(r.shopHours)}</td>}
                    {!hiddenCols.has("otherHours") && <td className="px-2 py-1.5 text-right">{r.otherHours ? fmtNum(r.otherHours) : "—"}</td>}
                    {!hiddenCols.has("pmCost") && <td className="px-2 py-1.5 text-right">{fmtMoney(r.pmCost)}</td>}
                    {!hiddenCols.has("mfgCost") && <td className="px-2 py-1.5 text-right">{fmtMoney(r.mfgCost)}</td>}
                    {!hiddenCols.has("laborCost") && <td className="px-2 py-1.5 text-right">{fmtMoney(r.laborCost)}</td>}
                    {!hiddenCols.has("etcEngHours") && (
                      <td className="px-2 py-1.5 text-right" title={showLiveEtc && live ? `Live: ${fmtNum(live.engHours)} (as of ${live.month})` : undefined}>
                        {r.etcEngHours == null ? "—" : fmtNum(r.etcEngHours)}
                        {showLiveEtc && live && <span className="ml-1 text-note text-sdc-blue">({fmtNum(live.engHours)})</span>}
                      </td>
                    )}
                    {!hiddenCols.has("etcShopHours") && (
                      <td className="px-2 py-1.5 text-right">
                        {r.etcShopHours == null ? "—" : fmtNum(r.etcShopHours)}
                        {showLiveEtc && live && <span className="ml-1 text-note text-sdc-blue">({fmtNum(live.shopHours)})</span>}
                      </td>
                    )}
                    {!hiddenCols.has("etcPartsCost") && (
                      <td className="px-2 py-1.5 text-right">
                        {r.etcPartsCost == null ? "—" : fmtMoney(r.etcPartsCost)}
                        {showLiveEtc && live && <span className="ml-1 text-note text-sdc-blue">({fmtMoney(live.partsCost)})</span>}
                      </td>
                    )}
                    {!hiddenCols.has("partCost") && <td className="px-2 py-1.5 text-right">{fmtMoney(r.partCost)}</td>}
                    {!hiddenCols.has("partInvoiced") && <td className="px-2 py-1.5 text-right">{fmtMoney(r.partInvoiced)}</td>}
                    {!hiddenCols.has("percentComplete") && <td className="px-2 py-1.5 text-right">{fmtPct(r.percentComplete)}</td>}
                    {!hiddenCols.has("salesPrice") && <td className="px-2 py-1.5 text-right">{fmtMoney(r.salesPrice)}</td>}
                    {!hiddenCols.has("startDate") && <td className="px-2 py-1.5 text-right">{r.startDate ? r.startDate.slice(0, 4) : "—"}</td>}
                    {!hiddenCols.has("completeDate") && <td className="px-2 py-1.5 text-right">{r.completeDate ? r.completeDate.slice(0, 4) : "—"}</td>}
                    {!hiddenCols.has("profit") && (
                      <td className={`px-2 py-1.5 text-right ${r.profit == null ? "" : r.profit >= 0 ? "text-sdc-green-text" : "text-sdc-red-text"}`}>{fmtMoney(r.profit)}</td>
                    )}
                    {!hiddenCols.has("margin") && (
                      <td className={`px-2 py-1.5 text-right ${r.margin == null ? "" : r.margin >= 0 ? "text-sdc-green-text" : "text-sdc-red-text"}`}>{fmtPct(r.margin)}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="sticky bottom-0 border-t-2 border-sdc-border bg-sdc-gray-50 font-semibold">
                <td className="px-2 py-2 text-left" colSpan={hiddenCols.has("customerName") ? 3 : 4}>{visibleRows.length} jobs</td>
                {!hiddenCols.has("actualHours") && <td className="px-2 py-2 text-right">{fmtNum(totals.actualHours)}</td>}
                {!hiddenCols.has("engineeringHours") && <td className="px-2 py-2 text-right">{fmtNum(totals.engineeringHours)}</td>}
                {!hiddenCols.has("shopHours") && <td className="px-2 py-2 text-right">{fmtNum(totals.shopHours)}</td>}
                {!hiddenCols.has("otherHours") && <td className="px-2 py-2 text-right">{fmtNum(totals.otherHours)}</td>}
                {!hiddenCols.has("pmCost") && <td className="px-2 py-2 text-right">{fmtMoney(totals.pmCost)}</td>}
                {!hiddenCols.has("mfgCost") && <td className="px-2 py-2 text-right">{fmtMoney(totals.mfgCost)}</td>}
                {!hiddenCols.has("laborCost") && <td className="px-2 py-2 text-right">{fmtMoney(totals.laborCost)}</td>}
                {!hiddenCols.has("etcEngHours") && <td className="px-2 py-2 text-right">{fmtNum(totals.etcEngHours)}</td>}
                {!hiddenCols.has("etcShopHours") && <td className="px-2 py-2 text-right">{fmtNum(totals.etcShopHours)}</td>}
                {!hiddenCols.has("etcPartsCost") && <td className="px-2 py-2 text-right">{fmtMoney(totals.etcPartsCost)}</td>}
                {!hiddenCols.has("partCost") && <td className="px-2 py-2 text-right">{fmtMoney(totals.partCost)}</td>}
                {!hiddenCols.has("partInvoiced") && <td className="px-2 py-2 text-right">{fmtMoney(totals.partInvoiced)}</td>}
                {!hiddenCols.has("percentComplete") && <td className="px-2 py-2" />}
                {!hiddenCols.has("salesPrice") && <td className="px-2 py-2 text-right">{fmtMoney(totals.salesPrice)}</td>}
                {!hiddenCols.has("startDate") && <td className="px-2 py-2" />}
                {!hiddenCols.has("completeDate") && <td className="px-2 py-2" />}
                {!hiddenCols.has("profit") && <td className={`px-2 py-2 text-right ${totals.profit != null && totals.profit >= 0 ? "text-sdc-green-text" : "text-sdc-red-text"}`}>{fmtMoney(totals.profit)}</td>}
                {!hiddenCols.has("margin") && <td className="px-2 py-2" />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {rateMatrixOpen && (
        <JobCostRateMatrixModal
          defaultRates={rates}
          overrides={overrides}
          years={[...new Set([...years, ...Object.keys(overrides)])].sort((a, b) => b.localeCompare(a))}
          onClose={() => setRateMatrixOpen(false)}
          onSaveDefault={applyDefaultRate}
          onSaveYear={applyYearOverride}
          onClearAll={clearAllOverrides}
        />
      )}
      {activeJobForAllocation && (
        <JobCostHourAllocationModal
          row={activeJobForAllocation}
          rates={rates}
          overrides={overrides}
          allocation={allocations[activeJobForAllocation.jobId] ?? null}
          onClose={() => setAllocationJobId(null)}
          onSave={(alloc) => applyAllocation(activeJobForAllocation.jobId, alloc)}
        />
      )}
    </div>
  );
}
