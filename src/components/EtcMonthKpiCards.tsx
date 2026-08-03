"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { usd, hours as fmtHours } from "@/components/ui/format";
import { HoursDetailPanel } from "@/components/HoursDetailPanel";
import { ETC_SECTIONS } from "@/lib/sections";
import { offGridBySection, sectionName, type OffGridJob } from "@/lib/off-grid-hours";
import type { EtcMonthKpis } from "@/lib/etc-month-kpis";
import type { JobHoursDetail } from "@/lib/job-hours-detail";
import type { UnattributedDetail } from "@/lib/unattributed-hours";
import { loadUnattributedDetail } from "@/lib/unattributed-actions";
import { readKpiStripOpen, writeKpiStripOpen, subscribeKpiStrip } from "@/lib/kpi-strip-pref";
import { useEtcLiveTotals } from "@/lib/etc-live-totals";

// Section code -> billing group, so the drill can be narrowed to the card that
// opened it. Same mapping the grid's column bands and the KPI totals use, from
// the same source, so "Engineering" means the identical set of sections in the
// card, the grid and the drill.
const SECTION_GROUP = new Map(ETC_SECTIONS.map((s) => [s.code, s.billingGroup]));

type DrillScope = "Engineering" | "Shop" | "All" | "Unattributed" | "OffGrid";

// Re-exported so the page's existing `import type { OffGridJob }` keeps working; the
// type and the rollup both live in lib/off-grid-hours.ts now, where a plain test can
// reach them (this component imports a "use server" action, which one cannot).
export type { OffGridJob };

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
  offGridJobs,
}: {
  month: string;
  kpis: EtcMonthKpis;
  detail: JobHoursDetail;
  // Time booked to something that isn't a job number. Passed in from the page,
  // which already loads it for the amber banner — one query, one number, so the
  // card and the banner cannot disagree.
  importIssues: { label: string; rows: number; hours: number }[];
  // Hours sitting in this month's EtcEntry rows against jobs the grid does not
  // render — jobs whose status moved off Active after the month was seeded. Same
  // data as the red banner above the grid; see where hiddenJobHours is built in
  // etc/page.tsx for why this is a business call rather than a bug to auto-fix.
  offGridJobs: OffGridJob[];
}) {
  // ── Live Diff (2026-08-03) ─────────────────────────────────────────────────
  //
  // Of everything on this strip, only the three Diffs depend on a cell anyone can
  // edit: Hours Worked, the people counts and Parts spent all come from booked
  // time and purchase data, so they are properties of the month, not of the draft
  // on screen. The Diffs are Hours Left − New ETC, and New ETC is exactly what a
  // manager is typing — so they were the one set of figures here that could sit
  // contradicting the grid three rows below them.
  //
  // Summed from the same published cells the grid's own totals use
  // (lib/etc-live-totals.ts), so a card cannot disagree with the total at the
  // bottom of the table — which is the property the comment above promises.
  //
  // Falls back to the server figure when nothing has published yet (the strip can
  // be open on a month whose grid rows haven't mounted), rather than showing a
  // confident zero.
  const liveTotals = useEtcLiveTotals();
  const liveDiffs = (() => {
    if (liveTotals.size === 0) return null;
    let engineering = 0;
    let shop = 0;
    let parts = 0;
    let sawParts = false;
    let engUnplanned = 0;
    let shopUnplanned = 0;
    for (const t of liveTotals.values()) {
      engineering += t.engineering.diff;
      shop += t.shop.diff;
      engUnplanned += t.engineering.diffUnplanned;
      shopUnplanned += t.shop.diffUnplanned;
      if (t.parts) {
        parts += t.parts.diff;
        sawParts = true;
      }
    }
    return { engineering, shop, parts: sawParts ? parts : null, engUnplanned, shopUnplanned };
  })();
  const engDiff = liveDiffs ? liveDiffs.engineering : kpis.engineering.diff;
  const shopDiff = liveDiffs ? liveDiffs.shop : kpis.shop.diff;
  const partsDiff = liveDiffs?.parts != null ? liveDiffs.parts : kpis.parts.diff;
  const engUnplanned = liveDiffs ? liveDiffs.engUnplanned : kpis.engineering.diffUnplanned;
  const shopUnplanned = liveDiffs ? liveDiffs.shopUnplanned : kpis.shop.diffUnplanned;

  // Summed here rather than passed in, so the card and its drill can never
  // disagree about how much is off the grid.
  const offGridTotal = offGridJobs.reduce((s, j) => s + j.hours, 0);
  // "By job" is the default because the ACTION lives on the job — setting it back to
  // Active is what saves the hours. "By section" answers the other question: what kind
  // of work is about to be lost.
  const [offGridView, setOffGridView] = useState<"job" | "section">("job");
  const offGridSections = useMemo(() => offGridBySection(offGridJobs), [offGridJobs]);

  // How many cards the strip will render, so the xl grid can be exactly that many
  // columns wide. FIVE fixed cards — Engineering hours, Shop hours, Parts spent, People
  // booked, Undefined hours — plus the off-grid one when it applies. Was six until
  // "Total hours worked" was removed on 2026-08-03; leaving this at 6 would have left a
  // permanently empty column at the end of the strip.
  const cardCount = 5 + (offGridJobs.length > 0 ? 1 : 0);

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
      {/* One row at xl, however many cards there are (2026-08-03, by request).
          The count VARIES — "Hours off the grid" only appears when there is
          something off the grid — so a hardcoded xl:grid-cols-6 wrapped the
          seventh card onto a line of its own, and hardcoding 7 would leave a gap
          on every normal month. The column count follows the card count instead,
          via a CSS variable, so both cases fill the row exactly.
          Below xl it still wraps to 2 or 3 — seven cards on a laptop would be
          unreadable, and this strip is a glance, not a table. */}
      {stripOpen && (
      <div
        style={{ ["--kpi-cols" as string]: String(cardCount) }}
        className="grid grid-cols-2 gap-1.5 lg:grid-cols-3 xl:[grid-template-columns:repeat(var(--kpi-cols),minmax(0,1fr))]"
      >
        <GroupCard
          label="Engineering hours"
          worked={kpis.engineering.worked}
          diff={engDiff}
          unplanned={engUnplanned}
          people={kpis.engineering.people}
          hasPunchData={kpis.hasPunchData}
          drillOpen={drill === "Engineering"}
          onDrill={() => toggleDrill("Engineering")}
        />
        <GroupCard
          label="Shop hours"
          worked={kpis.shop.worked}
          diff={shopDiff}
          unplanned={shopUnplanned}
          people={kpis.shop.people}
          hasPunchData={kpis.hasPunchData}
          drillOpen={drill === "Shop"}
          onDrill={() => toggleDrill("Shop")}
        />
        <Card label="Parts spent" value={usd(kpis.parts.spent)}>
          <Variance
            value={partsDiff}
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
        {/* "Total hours worked" removed 2026-08-03, by request. It was just
            Engineering + Shop, both of which are the two cards to its left, and its own
            hint spelled that out ("2,980 eng + 2,675 shop") — so it restated two figures
            already on screen and cost a column doing it. */}
        {/* Hours booked to something that isn't a job number. A card, not just
            the banner above the grid, because this is the one figure here that
            is MISSING from every other figure — it belongs beside the totals it
            is absent from, not only in a notice people learn to scroll past.
            Shown even at zero: "0 undefined hours" is a daily reassurance that
            the import is clean, where an absent card says nothing either way.

            Labelled "Undefined hours" (2026-08-03, by request). It read
            "Unattributed hours" until earlier the same day, then "Undefined errors"
            briefly; this is the settled name. The punches it counts are booked to the
            literal job number "NOT DEFINED", which is what the banner above the grid
            already calls them, so the card and the banner use one word for one thing —
            and "hours" is what the figure actually is, which "errors" was not.

            The internals still say `unattributed` throughout (types, the store,
            lib/unattributed-hours.ts) — that describes the data accurately and renaming
            it would touch six files for no visible gain. */}
        <Card
          label="Undefined hours"
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
        {/* Hours on jobs the grid isn't listing. The mirror image of the card
            beside it: those hours have no job, these have a job the grid has
            stopped showing — and both are MISSING from every other figure on this
            strip, which is exactly why they belong on it rather than only in a
            banner above a table people scroll past.
            Red rather than amber: undefined-error hours sit there until someone
            fixes Paylocity, but these rows are DELETED by the next Refresh Data or
            Submit ETC, so the window to act on them closes.
            Hidden at zero, unlike Undefined hours: "0 undefined hours" is a daily
            reassurance the import is clean, whereas a permanent "0 off-grid" card
            would just be a column of nothing on the normal month. */}
        {offGridJobs.length > 0 && (
          <Card
            label="Hours off the grid"
            value={fmtHours(offGridTotal)}
            tone="danger"
            hint={`${offGridJobs.length} ${offGridJobs.length === 1 ? "job" : "jobs"} not listed below — ${offGridJobs
              .slice(0, 2)
              .map((j) => j.jobId)
              .join(", ")}${offGridJobs.length > 2 ? `, +${offGridJobs.length - 2} more` : ""} — missing from every figure here`}
            drillOpen={drill === "OffGrid"}
            onDrill={() => toggleDrill("OffGrid")}
          />
        )}
      </div>
      )}

      {drill === "OffGrid" ? (
        <div className="rounded-xl border border-sdc-red-border bg-white p-4 shadow-sm">
          <p className="mb-1 text-xs font-semibold text-sdc-navy">
            {fmtHours(offGridTotal)} hours on {offGridJobs.length} {offGridJobs.length === 1 ? "job" : "jobs"} the grid isn&apos;t listing
          </p>
          {/* The WHY and the WHAT-NOW, not just the number. This is the one figure
              on the strip with a deadline attached, and a drill that only restated
              the total would send someone hunting for the explanation. */}
          <p className="mb-2 text-[11px] leading-relaxed text-sdc-gray-600">
            The grid lists <strong>Active, billable</strong> jobs only, so anything else lands here — a job that moved status, one that is
            non-billable, one already Complete, or a <strong>HeadStart</strong> job (no PO, so never planned in an ETC month; listed always,
            even at 0 hours, so one that starts booking time is seen). Set a job back to Active and billable to bring it into the month, or
            accept the shortfall deliberately.
          </p>
          {/* Sourced from JobHoursDetail, not EtcEntry — see where hiddenJobEntries is
              built. Worth stating outright, because the previous version of this panel
              promised the opposite and was right to: it read rows that prune deletes. */}
          <p className="mb-3 text-[11px] leading-relaxed text-sdc-gray-600">
            Counted from the <strong>punch records</strong>, so this figure stays visible and is not affected by Refresh Data or Submit ETC.
            It still reaches no total in the grid below until the job qualifies.
          </p>
          {/* Two readings of the same 181 hours. Both total identically — they have to,
              since the card above shows that figure too. */}
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-[10px] font-medium text-sdc-gray-500">Split by</span>
            {(["job", "section"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setOffGridView(v)}
                aria-pressed={offGridView === v}
                title={
                  v === "job"
                    ? "One row per job — the job is where the fix is (set it back to Active)"
                    : "One row per section, summed across every off-grid job"
                }
                className={`h-6 rounded-md border px-2 text-[10px] font-medium transition-colors ${
                  offGridView === v
                    ? "border-sdc-blue bg-sdc-blue text-white"
                    : "border-sdc-border bg-white text-sdc-navy hover:bg-sdc-blue-light"
                }`}
              >
                {v === "job" ? "Job" : "Section"}
              </button>
            ))}
          </div>
          <div className="styled-scrollbar max-h-72 overflow-auto rounded-lg border border-sdc-border">
            <table className="w-full border-collapse text-[11px]">
              <thead className="sticky top-0 bg-sdc-gray-100">
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-sdc-gray-500">
                  {offGridView === "job" ? (
                    <>
                      <th className="px-2 py-1.5">Job</th>
                      <th className="px-2 py-1.5">Status</th>
                      <th className="px-2 py-1.5">Sections</th>
                      <th className="px-2 py-1.5 text-right">Hours</th>
                    </>
                  ) : (
                    <>
                      <th className="px-2 py-1.5">Section</th>
                      <th className="px-2 py-1.5">Jobs</th>
                      <th className="px-2 py-1.5 text-right">Hours</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {offGridView === "job"
                  ? offGridJobs.map((j) => (
                      <tr key={j.jobId} className="border-t border-sdc-border-soft align-top">
                        <td className="px-2 py-1.5">
                          <span className="font-mono font-semibold text-sdc-blue-dark">{j.jobId}</span>
                          <span className="ml-1.5 text-sdc-gray-600">{j.jobName}</span>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-sdc-yellow-text">{j.status ?? "—"}</td>
                        {/* One section per LINE, named. It used to be a single
                            interpunct-joined string ("10-313 71 · 10-211 37 · …"),
                            which is unreadable past two sections and gave the codes no
                            names at all. */}
                        <td className="px-2 py-1.5 text-sdc-gray-600">
                          {/* A HeadStart job is listed even with nothing booked, so this
                              says so rather than leaving the cell blank and looking like
                              missing data. */}
                          {j.sections.length === 0 ? (
                            <span className="text-sdc-gray-400">No hours booked this month</span>
                          ) : (
                            // Name only — the code is dropped (2026-08-03, by request).
                            // It falls back to the code for anything the app does not
                            // model, so a row can never render as a bare number.
                            j.sections.map((s) => (
                              <span key={s.section} className="block whitespace-nowrap">
                                {sectionName(s.section) ?? s.section}
                                <span className="ml-1 font-semibold tabular-nums text-sdc-navy">{fmtHours(s.hours)}</span>
                              </span>
                            ))
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-sdc-navy">{fmtHours(j.hours)}</td>
                      </tr>
                    ))
                  : offGridSections.map((s) => (
                      <tr key={s.section} className="border-t border-sdc-border-soft align-top">
                        <td className="px-2 py-1.5 whitespace-nowrap text-sdc-navy">
                          {/* Name only, matching the by-job view. Falls back to the code
                              for a section the app does not model. */}
                          {s.name ?? s.section}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-sdc-gray-600">{s.jobIds.join(", ")}</td>
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-sdc-navy">{fmtHours(s.hours)}</td>
                      </tr>
                    ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-sdc-navy bg-sdc-gray-50 font-semibold">
                  <td className="px-2 py-1.5" colSpan={offGridView === "job" ? 3 : 2}>
                    Total
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-sdc-navy">{fmtHours(offGridTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {/* Parts Cost is excluded upstream: it stores DOLLARS in the same column
              these hours come from, so including it would put money in an hours
              total. Said here because a reader comparing this against the job's
              Parts row would otherwise think something was missing. */}
          <p className="mt-2 text-[10px] text-sdc-gray-400">Hours only — Parts Cost is money and is not counted here.</p>
        </div>
      ) : drill === "Unattributed" ? (
        loadingUnattributed || (!unattributed && !unattributedError) ? (
          <p className="rounded-xl border border-sdc-border bg-white p-4 text-xs text-sdc-gray-500 shadow-sm">
            Reading the hours export…
          </p>
        ) : unattributedError ? (
          <p className="rounded-xl border border-sdc-red-border bg-sdc-red-bg p-4 text-xs font-medium text-sdc-red-text shadow-sm">
            Could not load the undefined-hours detail — {unattributedError}
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
            // Matches the card that opened it — a drill panel titled with the old
            // name would read as a different report.
            title={`Undefined hours — ${month}`}
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
  // "danger" is for a figure that is not merely worth noticing but is about to
  // be LOST — see the off-grid card.
  tone?: "warn" | "danger";
  // Whether THIS card's panel is the one currently open, so the link can say so
  // instead of reading "Detail" while the detail is already on screen.
  drillOpen?: boolean;
}) {
  return (
    <div
      // px-2 py-1.5 rather than p-3, and the hint moved into the title: three
      // stacked lines per card was most of the height, and the third line was the
      // least-read of them. Padding came down again when the strip went to seven
      // across (2026-08-03) — at xl each card is now ~1/7 of the row, and the
      // widest content ("$1,432,857" beside "▼ $1,084,643 over") needs the space
      // more than the border does.
      className={`min-w-0 rounded-lg border px-2 py-1.5 shadow-sm ${
        tone === "danger"
          ? "border-sdc-red-border bg-sdc-red-bg/60"
          : tone === "warn"
            ? "border-sdc-yellow bg-sdc-yellow-bg/50"
            : "border-sdc-border bg-white"
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
      {/* min-w-0 + gap-1: with seven cards across, the value and its variance are
          competing for ~1/7 of the row. Without min-w-0 a flex child refuses to
          shrink below its content and the pair overflows the card; with it, the
          variance truncates instead — and its full text is still on the card's
          own title attribute. */}
      <div className="flex min-w-0 items-baseline justify-between gap-1">
        <p className="font-heading shrink-0 text-[16px] leading-tight font-bold tabular-nums text-sdc-navy">{value}</p>
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
  unplanned,
  people,
  hasPunchData,
  onDrill,
  drillOpen,
}: {
  label: string;
  worked: number;
  diff: number;
  // The part of `diff` from cells nobody has planned yet — see GroupKpi.
  unplanned: number;
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
      {/* While anything is still unplanned, the card reports THAT rather than a
          variance. A blank New ETC counts as 0 (2026-08-03), so an untouched cell
          contributes its whole Hours Left — real, but calling it "under plan"
          would be a lie: nobody has planned it at all. As cells get filled in the
          unplanned figure shrinks to zero and the card flips to the true
          over/under, which is exactly the state it needs to be right in at
          submission. Both numbers are always in the tooltip. */}
      {Math.round(unplanned) !== 0 ? (
        <Unplanned hours={unplanned} rest={diff - unplanned} />
      ) : (
        <Variance
          value={diff}
          format={fmtHours}
          title="Sum of (Hours Left − New ETC) over the cells a manager has confirmed"
        />
      )}
    </Card>
  );
}

// "Nobody has planned this yet" — deliberately NOT dressed as a variance.
//
// Neutral amber rather than the green/red of Variance: unplanned work is not
// good news or bad news, it is unfinished input. Painting it green (which a
// positive Diff would have done) actively told managers the opposite of what the
// number meant.
function Unplanned({ hours, rest }: { hours: number; rest: number }) {
  const restRounded = Math.round(rest);
  return (
    <p
      className="min-w-0 truncate text-[11px] font-semibold tabular-nums text-sdc-yellow-text"
      title={
        `${fmtHours(hours)} hours sit in sections with no New ETC entered — counted in full because an empty cell plans nothing. ` +
        (restRounded === 0
          ? "Every cell that HAS been planned is exactly on plan."
          : `Separately, the cells already planned are ${fmtHours(Math.abs(restRounded))} ${restRounded > 0 ? "under" : "over"}.`)
      }
    >
      {fmtHours(hours)} unplanned
    </p>
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
      // min-w-0 + truncate, not shrink-0: at seven cards across, the widest pair
      // on the strip ("$1,432,857" beside "▼ $1,084,643 over") exceeds a card at
      // the narrow end of xl. Something has to give, and it should be this rather
      // than the headline figure — so the variance clips with an ellipsis while
      // the value stays whole. The full text is on both this element's title and
      // the card's, so nothing becomes unreachable. On a wide screen it never
      // clips at all.
      className={`min-w-0 truncate text-[11px] font-semibold tabular-nums ${
        rounded > 0 ? "text-sdc-green-text" : "text-sdc-red-text"
      }`}
      title={title}
    >
      {rounded > 0 ? "▲" : "▼"} {format(Math.abs(value))} {rounded > 0 ? "under" : "over"}
    </p>
  );
}
