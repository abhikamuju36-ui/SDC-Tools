"use client";

import { useMemo, useState } from "react";
import { usd, hours as fmtHours } from "@/components/ui/format";
import { HoursDetailPanel } from "@/components/HoursDetailPanel";
import { ETC_SECTIONS } from "@/lib/sections";
import type { EtcMonthKpis } from "@/lib/etc-month-kpis";
import type { JobHoursDetail } from "@/lib/job-hours-detail";

// Section code -> billing group, so the drill can be narrowed to the card that
// opened it. Same mapping the grid's column bands and the KPI totals use, from
// the same source, so "Engineering" means the identical set of sections in the
// card, the grid and the drill.
const SECTION_GROUP = new Map(ETC_SECTIONS.map((s) => [s.code, s.billingGroup]));

type DrillScope = "Engineering" | "Shop" | "All";

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

export function EtcMonthKpiCards({
  month,
  kpis,
  detail,
}: {
  month: string;
  kpis: EtcMonthKpis;
  detail: JobHoursDetail;
}) {
  const [drill, setDrill] = useState<DrillScope | null>(null); // null = closed

  // The drill shows ONLY the sections belonging to the card that opened it —
  // Engineering from the Engineering card, Shop from Shop. It used to hand the
  // panel every punch in the month regardless, so a drill "opened from Shop"
  // listed ME Gen and Software rows and totalled the whole month, which made the
  // card and its own detail disagree.
  //
  // Narrowed here rather than in the panel: the panel's section dropdown and its
  // footer total both read off `detail`, so filtering the data is what keeps the
  // dropdown offering only this group's sections and the total matching the card.
  const scopedDetail = useMemo<JobHoursDetail>(() => {
    if (!drill || drill === "All") return detail;
    const rows = detail.rows.filter((r) => SECTION_GROUP.get(r.section) === drill);
    // Section totals recomputed from the kept rows, so the dropdown's per-section
    // figures still add up to the footer.
    const bySection = new Map<string, number>();
    for (const r of rows) bySection.set(r.section, (bySection.get(r.section) ?? 0) + r.hours);
    return {
      rows,
      total: rows.reduce((s, r) => s + r.hours, 0),
      sections: detail.sections.filter((s) => bySection.has(s.code)).map((s) => ({ ...s, hours: bySection.get(s.code)! })),
      truncated: detail.truncated,
    };
  }, [detail, drill]);

  // The card and its drill come from two different tables: the card sums
  // EtcEntry.hoursWorked (written by the hours sync), the drill sums the punch
  // rows in JobHoursDetail. They agree to within a couple of hours but not
  // exactly, because the two were last written at different times — measured
  // 2026-07-30, Engineering was 2086.54 on the card against 2078.52 in the
  // punches. Small, real, and guaranteed to look like a bug if left unexplained,
  // so say it out loud whenever the gap would be visible.
  const cardWorked = drill === "Engineering" ? kpis.engineering.worked : drill === "Shop" ? kpis.shop.worked : null;
  const gap = cardWorked == null ? 0 : scopedDetail.total - cardWorked;
  const scopeNote =
    Math.abs(gap) >= 1 && cardWorked != null
      ? `The card reads ${fmtHours(cardWorked)} — these punch rows total ${fmtHours(scopedDetail.total)}. ` +
        `The card comes from the ETC grid's Hours Worked; these rows are the Paylocity punches behind it, and the two were last synced at different times.`
      : undefined;

  return (
    <div className="mb-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <GroupCard
          label="Engineering hours"
          worked={kpis.engineering.worked}
          diff={kpis.engineering.diff}
          people={kpis.engineering.people}
          hasPunchData={kpis.hasPunchData}
          onDrill={() => setDrill("Engineering")}
        />
        <GroupCard
          label="Shop hours"
          worked={kpis.shop.worked}
          diff={kpis.shop.diff}
          people={kpis.shop.people}
          hasPunchData={kpis.hasPunchData}
          onDrill={() => setDrill("Shop")}
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
          onDrill={kpis.hasPunchData ? () => setDrill("All") : undefined}
        />
        <Card
          label="Total hours worked"
          value={fmtHours(kpis.engineering.worked + kpis.shop.worked)}
          hint={`${fmtHours(kpis.engineering.worked)} eng + ${fmtHours(kpis.shop.worked)} shop`}
        />
      </div>

      {drill && (
        <HoursDetailPanel
          detail={scopedDetail}
          note={scopeNote}
          // Names the scope rather than where the click came from: "Engineering
          // hours" says what the table contains, where "(opened from
          // Engineering)" only said how you got here.
          title={drill === "All" ? `Hours Detail — ${month}` : `${drill} hours — ${month}`}
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
