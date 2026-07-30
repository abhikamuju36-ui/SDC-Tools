"use client";

import { useState } from "react";
import { usd } from "@/components/ui/format";
import { HoursDetailPanel } from "@/components/HoursDetailPanel";
import type { EtcMonthKpis } from "@/lib/etc-month-kpis";
import type { JobHoursDetail } from "@/lib/job-hours-detail";

// KPI strip at the top of the Monthly ETC page: hours worked and variance for
// Engineering and Shop, parts money spent, and how many people booked time —
// with a drill-through to the punch detail behind the headcount.
//
// Every hours figure comes from the SAME EtcEntry rows the grid's grand-total row
// sums, with the same effective-New-ETC rule (see getEtcMonthKpis), so a card can
// never contradict the total at the bottom of the table. The people counts and
// the drill come from the punch-level rows, which is the same source those totals
// were built from.
//
// Diff keeps the grid's sign convention: Hours Left − New ETC, so POSITIVE means
// the New ETC is under what's left (green) and negative means over (red). Getting
// that backwards here while the grid had it right would be worse than not showing
// it at all.

const fmtHours = (n: number) => Math.round(n).toLocaleString();

export function EtcMonthKpiCards({
  month,
  kpis,
  detail,
}: {
  month: string;
  kpis: EtcMonthKpis;
  detail: JobHoursDetail;
}) {
  const [drill, setDrill] = useState<string | null>(null); // null = closed, else a group name

  // The drill panel filters by section, and a "group" is a set of sections, so
  // opening it from a group card shows the whole month and lets the section
  // dropdown narrow it. Passing a group as a section filter would match nothing.
  const openDrill = (label: string) => setDrill(label);

  return (
    <div className="mb-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <GroupCard
          label="Engineering hours"
          worked={kpis.engineering.worked}
          diff={kpis.engineering.diff}
          people={kpis.engineering.people}
          hasPunchData={kpis.hasPunchData}
          onDrill={() => openDrill("Engineering")}
        />
        <GroupCard
          label="Shop hours"
          worked={kpis.shop.worked}
          diff={kpis.shop.diff}
          people={kpis.shop.people}
          hasPunchData={kpis.hasPunchData}
          onDrill={() => openDrill("Shop")}
        />
        <Card label="Parts spent" value={usd(kpis.parts.spent)}>
          <Variance
            value={kpis.parts.diff}
            format={usd}
            title={`Money Left (${usd(kpis.parts.moneyLeft)}) − New ETC (${usd(kpis.parts.newEtc)})`}
          />
        </Card>
        <Card
          label="People booked"
          value={kpis.hasPunchData ? String(kpis.peopleTotal) : "—"}
          hint={
            kpis.hasPunchData
              ? // Not eng + shop: anyone who booked to both would be double-counted.
                `${kpis.engineering.people} engineering · ${kpis.shop.people} shop (distinct overall)`
              : "No punch-level hours stored for this month yet"
          }
          onDrill={kpis.hasPunchData ? () => openDrill("All") : undefined}
        />
        <Card
          label="Total hours worked"
          value={fmtHours(kpis.engineering.worked + kpis.shop.worked)}
          hint={`${fmtHours(kpis.engineering.worked)} eng + ${fmtHours(kpis.shop.worked)} shop`}
        />
      </div>

      {drill && (
        <HoursDetailPanel
          detail={detail}
          title={`Hours Detail — ${month}${drill === "All" ? "" : ` (opened from ${drill})`}`}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

function Card({
  label,
  value,
  hint,
  children,
  onDrill,
}: {
  label: string;
  value: string;
  hint?: string;
  children?: React.ReactNode;
  onDrill?: () => void;
}) {
  return (
    <div className="rounded-xl border border-sdc-border bg-white p-3 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-sdc-gray-500">{label}</p>
        {onDrill && (
          <button
            type="button"
            onClick={onDrill}
            className="shrink-0 text-[10px] font-medium text-sdc-blue underline decoration-dotted underline-offset-2 hover:text-sdc-blue-dark"
          >
            Detail
          </button>
        )}
      </div>
      <p className="font-heading text-xl font-bold tabular-nums text-sdc-navy">{value}</p>
      {children}
      {hint && <p className="mt-0.5 text-[10px] leading-tight text-sdc-gray-400">{hint}</p>}
    </div>
  );
}

function GroupCard({
  label,
  worked,
  diff,
  people,
  hasPunchData,
  onDrill,
}: {
  label: string;
  worked: number;
  diff: number;
  people: number;
  hasPunchData: boolean;
  onDrill: () => void;
}) {
  return (
    <Card
      label={label}
      value={fmtHours(worked)}
      hint={hasPunchData ? `${people} ${people === 1 ? "person" : "people"} booked time` : undefined}
      onDrill={hasPunchData ? onDrill : undefined}
    >
      <Variance value={diff} format={fmtHours} title="Hours Left − New ETC" />
    </Card>
  );
}

// The grid's Diff, in words. Positive = New ETC is under what's left (good),
// negative = over. Zero says "on plan" rather than "0", which reads as missing.
function Variance({ value, format, title }: { value: number; format: (n: number) => string; title: string }) {
  const rounded = Math.round(value);
  if (rounded === 0) {
    return (
      <p className="text-[11px] font-semibold text-sdc-gray-400" title={title}>
        On plan
      </p>
    );
  }
  return (
    <p
      className={`text-[11px] font-semibold tabular-nums ${rounded > 0 ? "text-sdc-green-text" : "text-sdc-red-text"}`}
      title={title}
    >
      {rounded > 0 ? "▲" : "▼"} {format(Math.abs(value))} {rounded > 0 ? "under" : "over"}
    </p>
  );
}
