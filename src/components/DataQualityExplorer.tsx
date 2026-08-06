"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { nextParams, notePendingParams } from "@/lib/url-params";
import type { EChartsOption } from "echarts";
import { EChart } from "@/components/charts/EChart";
import { card } from "@/components/ui/classnames";
import type { PunchExplorer } from "@/lib/data-quality";

// The Power BI Data Quality page's own layout: three header cards, its four
// slicers, the punch table with Is Punch Valid, and the stacked hours-by-
// department column chart. The findings panel below it answers "is anything
// wrong"; this is the part you slice when the answer is yes.
//
// Slicer state lives in the URL, not in component state, so a filtered view is
// a link someone can send — and so the server can do the filtering, which it
// must: the unfiltered window is ~49,000 punches and no useful amount of that
// belongs in the browser.

const SELECT = "h-8 rounded-lg border border-sdc-border bg-white px-2 text-xs text-sdc-navy outline-none focus:border-sdc-blue";
const TH = "px-2 py-1.5 text-left text-label font-bold uppercase tracking-wide text-white whitespace-nowrap";
const TD = "px-2 py-1 text-left text-note text-sdc-navy whitespace-nowrap";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex-1 rounded-lg bg-sdc-blue px-4 py-3 text-white">
      <p className="font-heading text-xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-label font-bold uppercase tracking-wide text-white/80">{label}</p>
      {sub && <p className="text-label text-white/60">{sub}</p>}
    </div>
  );
}

export function DataQualityExplorer({ data }: { data: PunchExplorer }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Every slicer writes the same way: set or clear one param, keep the rest, and
  // keep ?tab=quality so changing a filter doesn't bounce you back to Overview.
  function setParam(key: string, value: string | null) {
    // nextParams, not searchParams directly — these four slicers sit next to
    // each other and get used in quick succession, and until a change commits
    // useSearchParams still reports the value from before it. Building on that
    // would drop the slicer set a moment earlier. See lib/url-params.ts.
    const currentQs = searchParams.toString();
    const qs = nextParams(currentQs);
    if (value) qs.set(key, value);
    else qs.delete(key);
    qs.set("tab", "quality");
    const q = qs.toString();
    notePendingParams(currentQs, q);
    router.push(`${pathname}?${q}`, { scroll: false });
  }

  const from = searchParams.get("dqFrom") ?? "";
  const to = searchParams.get("dqTo") ?? "";
  const employeeId = searchParams.get("dqEmp") ?? "";
  const functionId = searchParams.get("dqFn") ?? "";
  const mtd = searchParams.get("dqMtd") === "1";

  const chartOption = useMemo<EChartsOption>(() => {
    // Top 12 departments; every employee inside one is a stack segment, as in the
    // report. More than a dozen columns and the labels stop being readable.
    const depts = data.byDepartment.slice(0, 12);
    const names = [...new Set(depts.flatMap((d) => d.employees.map((e) => e.name)))];
    return {
      grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
      tooltip: { trigger: "item", valueFormatter: (v: unknown) => `${Math.round(Number(v)).toLocaleString()}h` },
      xAxis: {
        type: "category",
        data: depts.map((d) => d.department),
        axisLabel: { interval: 0, rotate: 30, fontSize: 10, color: "#2b2b2b" },
      },
      yAxis: { type: "value", name: "Hours Actual", nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
      series: names.map((name) => ({
        name,
        type: "bar" as const,
        stack: "total",
        emphasis: { focus: "series" as const },
        data: depts.map((d) => d.employees.find((e) => e.name === name)?.hours ?? 0),
      })),
      // A legend of 60 employees would be taller than the chart — the stack is
      // there to show composition, and the tooltip names whichever slice you
      // point at.
      legend: { show: false },
    };
  }, [data.byDepartment]);

  return (
    <div className="space-y-4">
      {/* Header cards — the report's Model Refresh Date / Hours Refreshed Thru /
          Total Hours Actual, in the same order. */}
      <div className="flex flex-wrap gap-3">
        <Kpi label="Hours last imported" value={data.kpis.lastImported ?? "—"} />
        <Kpi label="Hours refreshed thru" value={data.kpis.refreshedThrough ?? "—"} />
        <Kpi
          label="Total hours actual"
          value={Math.round(data.kpis.totalHours).toLocaleString()}
          sub={`${data.kpis.totalPunches.toLocaleString()} punches`}
        />
        <Kpi label="Invalid punches" value={data.invalidCount.toLocaleString()} sub="in this selection" />
      </div>

      {/* Slicers */}
      <div className={`${card("p-3")} flex flex-wrap items-center gap-3`}>
        <label className="flex items-center gap-1.5 text-xs font-medium text-sdc-gray-600">
          Date
          <input type="date" value={from} onChange={(e) => setParam("dqFrom", e.target.value || null)} disabled={mtd} className={SELECT} />
          <span className="text-sdc-gray-400">→</span>
          <input type="date" value={to} onChange={(e) => setParam("dqTo", e.target.value || null)} disabled={mtd} className={SELECT} />
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-sdc-gray-600">
          <input type="checkbox" checked={mtd} onChange={(e) => setParam("dqMtd", e.target.checked ? "1" : null)} className="h-3.5 w-3.5" />
          Month to date
        </label>
        <select value={employeeId} onChange={(e) => setParam("dqEmp", e.target.value || null)} aria-label="Employee" className={SELECT}>
          <option value="">All employees</option>
          {data.options.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select value={functionId} onChange={(e) => setParam("dqFn", e.target.value || null)} aria-label="Function Id" className={SELECT}>
          <option value="">All function IDs</option>
          {data.options.functionIds.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        {(from || to || employeeId || functionId || mtd) && (
          <button
            type="button"
            onClick={() => {
              const currentQs = searchParams.toString();
              const qs = nextParams(currentQs);
              for (const k of ["dqFrom", "dqTo", "dqEmp", "dqFn", "dqMtd"]) qs.delete(k);
              qs.set("tab", "quality");
              const q = qs.toString();
              notePendingParams(currentQs, q);
              router.push(`${pathname}?${q}`, { scroll: false });
            }}
            className="text-xs font-medium text-sdc-blue hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        {/* Punch table — the report's main visual, same columns and same order. */}
        <div className={card("p-0")}>
          <div className="max-h-[26rem] overflow-auto styled-scrollbar rounded-xl">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-[1] bg-sdc-navy">
                <tr>
                  <th className={TH}>Department</th>
                  <th className={TH}>Emp Id</th>
                  <th className={TH}>Employee</th>
                  <th className={TH}>Date</th>
                  <th className={TH}>Job Id</th>
                  <th className={TH}>Job Name</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Complete</th>
                  <th className={TH}>Section-Function</th>
                  <th className={`${TH} text-right`}>Hours</th>
                  <th className={TH}>Is Punch Valid</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={`${r.employeeId}-${r.date}-${r.section}-${r.jobId}-${i}`} className={i % 2 === 1 ? "bg-sdc-gray-50/60" : ""}>
                    <td className={`${TD} text-sdc-muted`}>{r.department}</td>
                    <td className={`${TD} font-mono text-label`}>{r.employeeId}</td>
                    <td className={TD}>{r.employee}</td>
                    <td className={`${TD} font-mono text-label`}>{r.date}</td>
                    <td className={`${TD} font-mono text-label`}>{r.jobId}</td>
                    <td className={TD} title={r.jobName}>
                      <span className="block max-w-[16rem] truncate">{r.jobName}</span>
                    </td>
                    <td className={`${TD} text-sdc-muted`}>{r.jobStatus}</td>
                    <td className={`${TD} font-mono text-label text-sdc-muted`}>{r.completeDate ?? "—"}</td>
                    <td className={`${TD} font-mono text-label`}>{r.section}</td>
                    <td className={`${TD} text-right font-mono tabular-nums`}>{r.hours}</td>
                    {/* The reason, not just true/false: "invalid" on its own
                        sends someone back to the rule list to work out which one
                        fired. */}
                    <td className={`${TD} font-semibold ${r.valid ? "text-sdc-green-text" : "text-sdc-red-text"}`} title={r.reason}>
                      {r.valid ? "Valid" : r.reason}
                    </td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-sm text-sdc-gray-400">
                      No punches match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {data.truncated && (
            <p className="border-t border-sdc-border px-3 py-2 text-note text-sdc-gray-400">
              Showing the most recent 3,000 of {data.kpis.totalPunches.toLocaleString()} punches. The cards and the chart cover the
              whole selection — narrow the dates to see the rest here.
            </p>
          )}
        </div>

        {/* Hours by department, stacked per employee. */}
        <div className={card("p-4")}>
          <p className="mb-1 font-heading text-sm font-bold tracking-tight text-sdc-navy">Hours by department</p>
          <p className="mb-2 text-note text-sdc-muted">
            Stacked by employee. &quot;(undefined)&quot; is the tell — hours whose employee or department the roster can&apos;t resolve.
          </p>
          <EChart height={340} option={chartOption} />
        </div>
      </div>
    </div>
  );
}
