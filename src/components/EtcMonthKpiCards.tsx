"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { usd, hours as fmtHours } from "@/components/ui/format";
import { HoursDetailPanel } from "@/components/HoursDetailPanel";
import { ETC_SECTIONS } from "@/lib/sections";
import type { EtcMonthKpis } from "@/lib/etc-month-kpis";
import type { JobHoursDetail } from "@/lib/job-hours-detail";
import type { UnattributedDetail } from "@/lib/unattributed-hours";
import { loadUnattributedDetail } from "@/lib/unattributed-actions";
import { readKpiStripOpen, writeKpiStripOpen, subscribeKpiStrip } from "@/lib/kpi-strip-pref";

// Section code -> billing group, so the drill can be narrowed to the card that
// opened it. Same mapping the grid's column bands and the KPI totals use, from
// the same source, so "Engineering" means the identical set of sections in the
// card, the grid and the drill.
const SECTION_GROUP = new Map(ETC_SECTIONS.map((s) => [s.code, s.billingGroup]));

type DrillScope = "Engineering" | "Shop" | "All" | "Unattributed";

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
  importIssues,
}: {
  month: string;
  kpis: EtcMonthKpis;
  detail: JobHoursDetail;
  // Time booked to something that isn't a job number. Passed in from the page,
  // which already loads it for the amber banner — one query, one number, so the
  // card and the banner cannot disagree.
  importIssues: { label: string; rows: number; hours: number }[];
}) {
  const [drill, setDrill] = useState<DrillScope | null>(null); // null = closed
  // Whether the summary strip is showing. Read through useSyncExternalStore for the
  // same reason as the other client prefs: reading localStorage during render
  // hydrates differently from the server.
  const stripOpen = useSyncExternalStore(subscribeKpiStrip, readKpiStripOpen, () => true);
  const setStripOpen = writeKpiStripOpen;
  // The unattributed drill is fetched on click, not with the page: it re-parses
  // the hours export, which nobody should pay for unless they open it.
  const [unattributed, setUnattributed] = useState<UnattributedDetail | null>(null);
  const [loadingUnattributed, startUnattributed] = useTransition();
  const [unattributedError, setUnattributedError] = useState<string | null>(null);

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

  // Clicking a card's Detail link a second time CLOSES its panel — it's a
  // disclosure, and a control that opens something should put it away again
  // rather than leaving the only exit at the panel's far corner. Clicking a
  // DIFFERENT card still switches scope instead of closing, which is what
  // someone comparing Engineering against Shop is actually asking for.
  const toggleDrill = (scope: DrillScope) => setDrill((current) => (current === scope ? null : scope));

  const unattributedTotal = importIssues.reduce((s, i) => s + i.hours, 0);
  const unattributedEntries = importIssues.reduce((s, i) => s + i.rows, 0);

  function toggleUnattributed() {
    if (drill === "Unattributed") {
      setDrill(null);
      return;
    }
    setDrill("Unattributed");
    // Fetched once per page visit — the underlying export only changes on a
    // sync, and re-parsing it on every open would make the panel feel broken.
    if (unattributed || loadingUnattributed) return;
    setUnattributedError(null);
    startUnattributed(async () => {
      try {
        setUnattributed(await loadUnattributedDetail(month));
      } catch (err) {
        // Surfaced in the panel rather than thrown: this reads a file that can be
        // missing or stale, and losing the whole ETC page to an error boundary
        // over an optional drill would be a bad trade.
        setUnattributedError(err instanceof Error ? err.message : "Could not read the hours export.");
      }
    });
  }

  return (
    <div className="mb-4">
      {/* Collapsible, and remembered. Six boxes three lines tall pushed the grid —
          the thing people came for — below the fold on a laptop. Compact by
          default now, and hideable outright for anyone who never wants them. */}
      <div className="mb-1.5 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setStripOpen(!stripOpen)}
          aria-expanded={stripOpen}
          className="text-[10px] font-medium text-sdc-gray-500 underline decoration-dotted underline-offset-2 hover:text-sdc-navy"
        >
          {stripOpen ? "Hide summary" : "Show summary"}
        </button>
      </div>
      {stripOpen && (
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
        <GroupCard
          label="Engineering hours"
          worked={kpis.engineering.worked}
          diff={kpis.engineering.diff}
          people={kpis.engineering.people}
          hasPunchData={kpis.hasPunchData}
          drillOpen={drill === "Engineering"}
          onDrill={() => toggleDrill("Engineering")}
        />
        <GroupCard
          label="Shop hours"
          worked={kpis.shop.worked}
          diff={kpis.shop.diff}
          people={kpis.shop.people}
          hasPunchData={kpis.hasPunchData}
          drillOpen={drill === "Shop"}
          onDrill={() => toggleDrill("Shop")}
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
          drillOpen={drill === "All"}
          onDrill={kpis.hasPunchData ? () => toggleDrill("All") : undefined}
        />
        <Card
          label="Total hours worked"
          value={fmtHours(kpis.engineering.worked + kpis.shop.worked)}
          hint={`${fmtHours(kpis.engineering.worked)} eng + ${fmtHours(kpis.shop.worked)} shop`}
        />
        {/* Hours booked to something that isn't a job number. A card, not just
            the banner above the grid, because this is the one figure here that
            is MISSING from every other figure — it belongs beside the totals it
            is absent from, not only in a notice people learn to scroll past.
            Shown even at zero: "0 unattributed" is a daily reassurance that the
            import is clean, where an absent card says nothing either way. */}
        <Card
          label="Unattributed hours"
          value={fmtHours(unattributedTotal)}
          tone={unattributedTotal > 0 ? "warn" : undefined}
          hint={
            unattributedTotal > 0
              ? `${unattributedEntries} ${unattributedEntries === 1 ? "entry" : "entries"} · ${importIssues
                  .map((i) => i.label)
                  .join(", ")} — not counted in any figure here`
              : "Every punch this month has a valid job number"
          }
          drillOpen={drill === "Unattributed"}
          onDrill={unattributedTotal > 0 ? toggleUnattributed : undefined}
        />
      </div>
      )}

      {drill === "Unattributed" ? (
        loadingUnattributed || (!unattributed && !unattributedError) ? (
          <p className="rounded-xl border border-sdc-border bg-white p-4 text-xs text-sdc-gray-500 shadow-sm">
            Reading the hours export…
          </p>
        ) : unattributedError ? (
          <p className="rounded-xl border border-sdc-red-border bg-sdc-red-bg p-4 text-xs font-medium text-sdc-red-text shadow-sm">
            Could not load the unattributed detail — {unattributedError}
          </p>
        ) : (
          <HoursDetailPanel
            detail={unattributed!}
            // The card counts what the last SYNC stored; these rows are read live
            // from the export. Normally identical — but if the file has moved on,
            // say so rather than letting a card and its own drill quietly differ.
            note={
              Math.abs(unattributed!.total - unattributed!.storedTotal) >= 1
                ? `The card reads ${fmtHours(unattributed!.storedTotal)} from the last sync — the export now holds ${fmtHours(
                    unattributed!.total,
                  )}. Refresh Data to bring the stored figure up to date.`
                : "These punches reach no figure on this page. Correct the job number in Paylocity, then Refresh Data."
            }
            title={`Unattributed hours — ${month}`}
            onClose={() => setDrill(null)}
          />
        )
      ) : (
        drill && (
          <HoursDetailPanel
            detail={scopedDetail}
            note={scopeNote}
            // Names the scope rather than where the click came from: "Engineering
            // hours" says what the table contains, where "(opened from
            // Engineering)" only said how you got here.
            title={drill === "All" ? `Hours Detail — ${month}` : `${drill} hours — ${month}`}
            onClose={() => setDrill(null)}
          />
        )
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
  drillOpen = false,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  children?: React.ReactNode;
  onDrill?: () => void;
  // "warn" tints the card amber — used for a figure that represents work to do
  // rather than work done. Deliberately not red: nothing is broken, some hours
  // are mis-keyed upstream.
  tone?: "warn";
  // Whether THIS card's panel is the one currently open, so the link can say so
  // instead of reading "Detail" while the detail is already on screen.
  drillOpen?: boolean;
}) {
  return (
    <div
      // px-2.5 py-1.5 rather than p-3, and the hint moved into the title: three
      // stacked lines per card was most of the height, and the third line was the
      // least-read of them.
      className={`rounded-lg border px-2.5 py-1.5 shadow-sm ${
        tone === "warn" ? "border-sdc-yellow bg-sdc-yellow-bg/50" : "border-sdc-border bg-white"
      }`}
      title={hint}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-sdc-gray-500">{label}</p>
        {onDrill && (
          <button
            type="button"
            onClick={onDrill}
            aria-expanded={drillOpen}
            title={drillOpen ? "Hide the punch detail" : "Show every booked punch behind this figure"}
            className={`shrink-0 text-[10px] font-medium underline decoration-dotted underline-offset-2 ${
              drillOpen ? "text-sdc-navy" : "text-sdc-blue hover:text-sdc-blue-dark"
            }`}
          >
            {drillOpen ? "Hide" : "Detail"}
          </button>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-heading text-[17px] leading-tight font-bold tabular-nums text-sdc-navy">{value}</p>
        {/* Variance sits BESIDE the number rather than under it — same information,
            one line instead of two. */}
        {children}
      </div>
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
  drillOpen,
}: {
  label: string;
  worked: number;
  diff: number;
  people: number;
  hasPunchData: boolean;
  onDrill: () => void;
  drillOpen?: boolean;
}) {
  return (
    <Card
      label={label}
      value={fmtHours(worked)}
      hint={hasPunchData ? `${people} ${people === 1 ? "person" : "people"} booked time` : undefined}
      onDrill={hasPunchData ? onDrill : undefined}
      drillOpen={drillOpen}
    >
      <Variance
        value={diff}
        format={fmtHours}
        title="Sum of (Hours Left − New ETC) over the cells a manager has confirmed"
      />
    </Card>
  );
}

// The grid's Diff, in words. Positive = New ETC is under what's left (good),
// negative = over. Zero says "on plan" rather than "0", which reads as missing.
function Variance({
  value,
  format,
  title,
}: {
  value: number;
  format: (n: number) => string;
  title: string;
}) {
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
      className={`shrink-0 text-[11px] font-semibold whitespace-nowrap tabular-nums ${
        rounded > 0 ? "text-sdc-green-text" : "text-sdc-red-text"
      }`}
      title={title}
    >
      {rounded > 0 ? "▲" : "▼"} {format(Math.abs(value))} {rounded > 0 ? "under" : "over"}
    </p>
  );
}
