"use client";

import { useMemo, useState } from "react";
import { hours as fmtHours, hoursExact } from "@/components/ui/format";
// The one drill-through design (§47) — shared with HoursDetailPanel, which is what
// stops these two tables from drifting apart again.
import {
  DRILL_BODY,
  DRILL_CAP,
  DRILL_NUM,
  DRILL_TOTAL_LABEL,
  DrillControls,
  DrillFilters,
  DrillGroup,
  DrillGroupOption,
  DrillGroupTray,
  DrillLines,
  DrillTable,
} from "@/components/ui/Drill";
import { reconcileUndefined, reconciliationMessage, type UndefinedReason } from "@/lib/undefined-hours-rules";
import type { UnattributedDetail } from "@/lib/unattributed-hours";
// One rollup implementation for every drill on this page — including the grid's
// department and section ordering. See the note on groupHoursRows.
import { groupHoursRows, GROUP_LABEL, type GroupKey } from "@/components/HoursDetailPanel";

// ── The Undefined Hours drill-through (§42.11, §42.27, §42.28) ──────────────
//
// This used to borrow HoursDetailPanel, which is built for "who worked on this job" —
// a flat punch list grouped by department/employee/section. That is the wrong shape
// here. These rows are not work to be understood, they are FAULTS to be corrected, and
// the question a manager has is "what do I go and fix, and where".
//
// So the panel leads with the reason breakdown, tells you what to do about each one,
// and states its reconciliation against the KPI outright rather than leaving two
// numbers on different parts of the screen for a reader to compare.
//
// ── Why the reconciliation line is prominent rather than a footnote ─────────
//
// §42.28 requires the drill to show reconciliation status and treat a mismatch as an
// application issue. That is not defensive decoration: the card and this panel read
// two different tables until 2026-08-05, and the previous version of this drill
// carried a note explaining that they might disagree. They cannot disagree any more —
// both come from one pass over one import — so the line is now an assertion the app
// makes about itself, and a red one means something is genuinely broken.

const REASON_TONE: Record<string, string> = {
  // Faults somebody can fix in Paylocity — amber, because this is work to do rather
  // than something broken.
  fault: "border-sdc-yellow bg-sdc-yellow-bg/50",
  // Correct exclusions — neutral. Colouring these as problems is what would train
  // people to ignore the colour.
  excluded: "border-sdc-border bg-sdc-gray-50",
};

export function UndefinedHoursPanel({
  detail,
  month,
  onClose,
}: {
  detail: UnattributedDetail;
  month: string;
  onClose: () => void;
}) {
  // Which reason is being looked at. `null` = all counted rows, which is the state in
  // which the visible total equals the KPI — the §42.11 identity. Filtering narrows
  // the list and the panel says so, so a filtered subtotal is never mistaken for the
  // headline.
  const [reason, setReason] = useState<UndefinedReason | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [query, setQuery] = useState("");

  // ── Grouped by department by default (2026-08-05, by request) ─────────────
  //
  // Same rollup, same chips and the same grid ordering as the other drills — via
  // groupHoursRows, not a second implementation. The undefined rows are structurally
  // HoursDetailRow (plus reason/sourceRow), so they group without adaptation, and the
  // department order comes from EMPLOYEE_TEAMS exactly as it does on the Engineering
  // and Shop drills.
  //
  // Department rather than Reason as the default, even though reason is what this panel
  // is about: the reason breakdown is already stated above as its own block, so opening
  // on it would say the same thing twice. Department answers the question the block
  // does not — WHOSE time this is, and therefore who to go and ask.
  const [groupBy, setGroupBy] = useState<GroupKey[]>(["department"]);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return detail.rows.filter((r) => {
      if (reason && r.reason !== reason) return false;
      if (!q) return true;
      return (
        r.employee.toLowerCase().includes(q) ||
        r.job.toLowerCase().includes(q) ||
        r.section.toLowerCase().includes(q) ||
        r.date.includes(q)
      );
    });
  }, [detail.rows, reason, query]);

  const shownTotal = rows.reduce((s, r) => s + r.hours, 0);
  const filtered = reason != null || query.trim() !== "";
  const recon = reconcileUndefined(detail.total, detail.storedTotal);
  const groups = useMemo(() => groupHoursRows(rows, groupBy), [rows, groupBy]);

  return (
    <section
      // Capped, with one scrolling body (§49) — the same treatment DrillPanel gives the
      // other drills, applied here because this panel owns its own shell (see the header
      // note for why it is not DrillPanel).
      //
      // The header, the four figures and the reconciliation line stay OUTSIDE the
      // scroller: Close has to be reachable, and the reconciliation line is an assertion
      // the app makes about itself (§42.28) — scrolling it out of sight would be the one
      // thing on this panel that must not happen.
      // No `overflow-hidden` alongside the ceiling: this panel's fixed region is the
      // tallest of the four (a heading, four figures and the reconciliation line), and at
      // extreme zoom it can exceed the ceiling's own floor on its own. Clipping there
      // would make the table unreachable; overflowing is merely untidy, and the page
      // scrolls. Nothing needs the clip — the last child is the padded body, so no
      // background reaches the rounded corners.
      className={`motion-panel flex ${DRILL_CAP} flex-col rounded-xl border border-sdc-border bg-white shadow-sm`}
      aria-label={`Undefined hours detail for ${month}`}
    >
      {/* ── Header: title, month, KPI total, close (§42.27) ─────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-sdc-border-soft px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-sdc-navy">
            Undefined hours <span className="font-normal text-sdc-muted">— {month}</span>
          </h3>
          <p className="mt-0.5 text-note leading-relaxed text-sdc-gray-600">
            Time booked to something that isn&apos;t a usable job number. It reaches{" "}
            <strong>no figure on this page</strong> — not the grid, not the totals, not the Engineering or Shop KPIs.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-sdc-border bg-white px-2.5 py-1 text-label font-medium text-sdc-gray-600 motion-interactive hover:bg-sdc-blue-light"
        >
          Close
        </button>
      </header>

      {/* ── The three numbers §42.27 asks for, before any table ──────────── */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-px border-b border-sdc-border-soft bg-sdc-border-soft">
        <Stat label="Undefined hours" value={fmtHours(detail.storedTotal)} title={hoursExact(detail.storedTotal)} emphasis />
        <Stat label="Records affected" value={String(detail.rows.length)} />
        <Stat label="Employees affected" value={String(detail.employeesAffected)} />
        <Stat
          label="Correctly excluded"
          value={fmtHours(detail.excluded.hours)}
          title="Phases the app does not model and the four Standard Fees pool sections. Not a fault, and not counted in the KPI."
        />
      </div>

      {/* ── Reconciliation status (§42.28) ───────────────────────────────── */}
      <p
        role={recon.ok ? undefined : "alert"}
        className={`flex items-center gap-2 px-4 py-2 text-label font-medium ${
          recon.ok ? "bg-sdc-blue-light/50 text-sdc-gray-600" : "bg-sdc-red-bg text-sdc-red-text"
        }`}
      >
        {/* Not colour alone (§42.23): the glyph and the wording both carry it. */}
        <span aria-hidden>{recon.ok ? "✓" : "✕"}</span>
        {reconciliationMessage(detail.total, detail.storedTotal)}
        {!recon.ok && <span className="font-normal">— this is an application fault, not a display issue. Please report it.</span>}
      </p>

      {/* The scrolling body. The reason cards, the controls and the table are all in it
          together: the cards are the tallest block on the panel and the controls sit
          between them and the table, so pinning the controls would mean pinning the cards
          too and leaving the table a sliver. The table's own header stays visible while
          the rows scroll — that is what `sticky` on DrillLines' thead is for. */}
      <div className={`${DRILL_BODY} px-4 py-3`}>
        {/* ── Reasons, with what to do about each (§42.12, §42.27) ───────── */}
        {detail.groups.length > 0 && (
          <>
            <h4 className="mb-1.5 text-label font-semibold uppercase tracking-wide text-sdc-muted">Why these are undefined</h4>
            <ul className="mb-3 grid gap-1.5 md:grid-cols-2">
              {detail.groups.map((g) => {
                const active = reason === g.reason;
                return (
                  <li key={g.reason}>
                    <button
                      type="button"
                      onClick={() => setReason(active ? null : g.reason)}
                      aria-pressed={active}
                      className={`w-full rounded-lg border px-3 py-2 text-left motion-interactive ${REASON_TONE.fault} ${
                        active ? "ring-2 ring-sdc-blue ring-offset-1" : "hover:border-sdc-yellow-text"
                      }`}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-semibold text-sdc-navy">{g.label}</span>
                        <span className="shrink-0 text-xs font-bold tabular-nums text-sdc-navy" title={hoursExact(g.hours)}>
                          {fmtHours(g.hours)}
                        </span>
                      </span>
                      {/* The corrective action — §42.27's "corrective data needed". */}
                      <span className="mt-0.5 block text-note leading-relaxed text-sdc-gray-600">{g.fix}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {/* ── Group by and filters, in the shared drill controls (§47) ─────────
            One row, the same tray and the same filter treatment as every other drill —
            these were a line of solid-blue chips plus a separate Ungroup button, which
            read as five primary actions and matched nothing else in the app. The
            behaviour is unchanged: the dimensions still toggle (so "Department ›
            Employee" is reachable) and "Punches" is the old Ungroup. */}
        <DrillControls>
          <DrillGroupTray>
            {(Object.keys(GROUP_LABEL) as GroupKey[]).map((k) => {
              const on = groupBy.includes(k);
              const rank = groupBy.indexOf(k) + 1;
              return (
                <DrillGroupOption
                  key={k}
                  on={on}
                  onClick={() => {
                    // Toggling a dimension, not replacing the set — "Department › Employee"
                    // is a real question ("which of Mechanical's people did this?") and the
                    // other drills already work this way.
                    setGroupBy((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
                    setOpenGroup(null);
                  }}
                  title={
                    on
                      ? `Grouped by ${GROUP_LABEL[k].toLowerCase()} (level ${rank}) — click to remove`
                      : `Roll the records up by ${GROUP_LABEL[k].toLowerCase()}`
                  }
                >
                  {groupBy.length > 1 && on ? `${rank}. ` : ""}
                  {GROUP_LABEL[k]}
                </DrillGroupOption>
              );
            })}
            <DrillGroupOption
              on={groupBy.length === 0}
              onClick={() => {
                setGroupBy([]);
                setOpenGroup(null);
              }}
              title="Show the individual punches"
            >
              {/* "Punches", matching the hours drill (2026-08-05, by request). Both trays
                  end in the same un-grouped option and it must read the same in both. */}
              Punches
            </DrillGroupOption>
          </DrillGroupTray>

          <DrillFilters>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search employee, job, section or date"
              aria-label="Search undefined hours"
              className="h-7 min-w-[12rem] flex-1 rounded-md border border-sdc-border-soft px-2 text-note outline-none motion-interactive focus:border-sdc-blue"
            />
            {filtered && (
              <button
                type="button"
                onClick={() => {
                  setReason(null);
                  setQuery("");
                }}
                className="h-7 shrink-0 rounded-md border border-sdc-border bg-white px-2 text-note font-medium text-sdc-muted motion-interactive hover:text-sdc-navy"
              >
                Clear filters
              </button>
            )}
          </DrillFilters>
        </DrillControls>

        {/* What the table currently IS — the shared design's meta line, in the position
            this panel has room for it (its heading is the KPI strip above). No record
            count anywhere in it (§62): the active rollup is named, not counted — the
            KPI reconciliation banner above already states the total, in hours. */}
        <p className="px-4 pb-2 text-note text-sdc-muted">
          {groups ? `Grouped by ${groupBy.map((k) => GROUP_LABEL[k].toLowerCase()).join(" › ")}` : "All records"}
          {/* A filtered view no longer equals the KPI, and says so rather than letting a
              subtotal be read as the headline. */}
          {filtered && (
            <>
              {" · showing "}
              <strong className="font-semibold text-sdc-navy" title={hoursExact(shownTotal)}>
                {fmtHours(shownTotal)}
              </strong>
              {` of the ${fmtHours(detail.storedTotal)} total — clear the filters to reconcile against the KPI`}
            </>
          )}
        </p>

        {/* ── The records ──────────────────────────────────────────────────── */}
        {detail.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-sdc-border bg-sdc-gray-50 px-3 py-6 text-center text-note text-sdc-muted">
            Every punch this month has a valid job number. Nothing to correct.
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-sdc-border bg-sdc-gray-50 px-3 py-6 text-center text-note text-sdc-muted">
            No records match these filters.
          </p>
        ) : groups ? (
          /* ── The rollup, in the shared drill table (§47) ─────────────────────
             One row per group, a caret that opens the lines underneath, the total at the
             bottom. It used to hand-roll all of that with a navy-ruled footer, a ▼/▶
             glyph swap and a colspan'd nested table — none of which matched the hours
             drill doing the identical job. */
          <DrillTable
            columns={groupBy.map((k) => GROUP_LABEL[k])}
            unit="Hours"
            totalLabel={filtered ? "Shown" : "Total"}
            total={fmtHours(shownTotal)}
            totalTitle={hoursExact(shownTotal)}
          >
            {groups.map((g) => (
              <DrillGroup
                key={g.key}
                values={g.values}
                total={fmtHours(g.hours)}
                totalTitle={hoursExact(g.hours)}
                open={openGroup === g.key}
                onToggle={() => setOpenGroup(openGroup === g.key ? null : g.key)}
                columns={groupBy.length}
              >
                <DrillLines
                  head={
                    <>
                      <th className="w-24">Date</th>
                      <th>Employee</th>
                      <th className="w-32">Job cell</th>
                      <th className="w-48">Section</th>
                      <th className="w-36">Reason</th>
                      <th className="w-20 text-right">Hours</th>
                      <th className="w-16 text-right">Row</th>
                    </>
                  }
                >
                  {(g.rows as UnattributedDetail["rows"]).map((r, i) => (
                    <tr key={`${r.date}-${r.sourceRow}-${i}`}>
                      <td className="whitespace-nowrap font-mono tabular-nums text-sdc-muted">{r.date}</td>
                      <td className="text-sdc-gray-700">{r.employee}</td>
                      {/* The raw cell value is the thing to go and correct, so it stays
                          monospaced and emphasised rather than muted with the rest. */}
                      <td className="font-mono font-semibold text-sdc-red-text">{r.job}</td>
                      <td className="whitespace-nowrap text-sdc-muted">
                        {r.sectionName === r.section ? r.section : `${r.section} — ${r.sectionName}`}
                      </td>
                      <td className="whitespace-nowrap text-sdc-muted">{r.reasonLabel}</td>
                      <td className={DRILL_NUM} title={hoursExact(r.hours)}>
                        {fmtHours(r.hours)}
                      </td>
                      <td className="text-right font-mono tabular-nums text-sdc-muted">{r.sourceRow || "—"}</td>
                    </tr>
                  ))}
                </DrillLines>
              </DrillGroup>
            ))}
          </DrillTable>
        ) : (
          // No scroll container of its own (§49): the panel body above IS the scroller,
          // and a second one nested inside it would cap the Lines view shorter than the
          // rollup it toggles with. The sticky header and total row work against the
          // body's scroller exactly as they did against this one.
          <div className="border-t border-sdc-border">
            <DrillLines
              head={
                <>
                  <th className="w-24">Date</th>
                  <th>Employee</th>
                  <th className="w-40">Department</th>
                  <th className="w-32">Job cell</th>
                  <th className="w-48">Section</th>
                  <th className="w-36">Reason</th>
                  <th className="w-20 text-right">Hours</th>
                  {/* The source row, so somebody can open the workbook and find it. */}
                  <th className="w-16 text-right">Row</th>
                </>
              }
              foot={
                <tr>
                  <td className={DRILL_TOTAL_LABEL} colSpan={6}>
                    {filtered ? "Shown" : "Total"}
                  </td>
                  <td className={`${DRILL_NUM} text-sm font-semibold`} title={hoursExact(shownTotal)}>
                    {fmtHours(shownTotal)}
                  </td>
                  <td />
                </tr>
              }
            >
              {rows.map((r, i) => (
                <tr key={`${r.date}-${r.employee}-${r.section}-${r.sourceRow}-${i}`}>
                  <td className="whitespace-nowrap font-mono tabular-nums text-sdc-muted">{r.date}</td>
                  <td className="text-sdc-gray-700">{r.employee}</td>
                  <td className="text-sdc-muted">{r.department}</td>
                  {/* The raw cell value is the thing to go and correct, so it is
                      monospaced and emphasised rather than buried. */}
                  <td className="font-mono font-semibold text-sdc-red-text">{r.job}</td>
                  <td className="whitespace-nowrap text-sdc-muted">
                    {r.sectionName === r.section ? r.section : `${r.section} — ${r.sectionName}`}
                  </td>
                  <td className="whitespace-nowrap text-sdc-muted">{r.reasonLabel}</td>
                  <td className={DRILL_NUM} title={hoursExact(r.hours)}>
                    {fmtHours(r.hours)}
                  </td>
                  <td className="text-right font-mono tabular-nums text-sdc-muted">{r.sourceRow || "—"}</td>
                </tr>
              ))}
            </DrillLines>
          </div>
        )}

        {/* ── Correct exclusions, behind a disclosure (§42.7) ──────────────── */}
        {detail.excluded.rows > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowExcluded((v) => !v)}
              aria-expanded={showExcluded}
              className="text-label font-medium text-sdc-blue-dark underline-offset-2 hover:underline"
            >
              {showExcluded ? "Hide" : "Show"} correctly-excluded records ({fmtHours(detail.excluded.hours)})
            </button>
            {showExcluded && (
              <div className={`mt-1.5 rounded-lg border px-3 py-2 ${REASON_TONE.excluded}`}>
                <p className="mb-1.5 text-note leading-relaxed text-sdc-gray-600">
                  These are <strong>not faults</strong> and are not counted in the KPI. They are hours the app deliberately does not model —
                  phases 80 and 90, and the four sections planned company-wide in the Standard Fees pools rather than job by job. Listed so
                  &ldquo;where did the rest of the hours go&rdquo; has an answer.
                </p>
                <ul className="grid gap-1 md:grid-cols-2">
                  {detail.excluded.groups.map((g) => (
                    <li key={g.reason} className="flex items-baseline justify-between gap-2 text-note">
                      <span className="text-sdc-gray-600">{g.label}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-sdc-navy" title={hoursExact(g.hours)}>
                        {fmtHours(g.hours)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Provenance — which file version these rows came from (§42.11). */}
        {detail.sourceFile && (
          <p className="mt-3 text-label text-sdc-gray-400">
            From <span className="font-medium text-sdc-muted">{detail.sourceFile}</span>
            {detail.importedAt && <> · imported {detail.importedAt.toLocaleString()}</>}
          </p>
        )}
      </div>
    </section>
  );
}

// One figure in the header strip. Equal weight by default (§42.22: "give each KPI
// equal visual importance"), with the headline allowed to be larger — it is the number
// the card was clicked to explain.
function Stat({ label, value, title, emphasis }: { label: string; value: string; title?: string; emphasis?: boolean }) {
  return (
    <div className="bg-white px-4 py-2.5">
      <div className="text-label font-medium uppercase tracking-wide text-sdc-muted">{label}</div>
      <div className={`tabular-nums text-sdc-navy ${emphasis ? "text-lg font-bold" : "text-base font-semibold"}`} title={title}>
        {value}
      </div>
    </div>
  );
}
