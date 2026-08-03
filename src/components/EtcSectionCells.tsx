"use client";

import { useEffect, useState } from "react";
import { calcHoursLeft, suggestNewEtc, round2 } from "@/lib/etc";
import { registerEtcField, forgetEtcField, updateEtcField } from "@/lib/etc-dirty-tracker";
import { publishEtcCell, forgetEtcCell } from "@/lib/etc-live-totals";
import { hours as formatHours } from "@/components/ui/format";
import { ETC_COL_W } from "@/components/ui/classnames";

const HOURS_WORKED_BG = "bg-[#C7DAF7]";
const HOURS_LEFT_BG = "bg-[#F1F6FD]";
function newEtcBg(hasValue: boolean) {
  return hasValue ? "bg-[#F2F2F2]" : "bg-[#FAFAC4]";
}
function diffBg(diff: number) {
  if (Math.abs(diff) < 0.005) return "bg-white";
  return diff < 0 ? "bg-[#EEADAC]" : "bg-[#9FCE62]";
}
// Whole hours with thousands separators, via the shared formatter — these cells
// sit in the same rows as the ones rendered by etc/page.tsx, so the two must
// format identically or one grid row would print "1,769" beside "1769".
//
// Display only. The hidden hoursWorked field submits String(worked) and the New
// ETC input holds its own raw text, both deliberately unformatted: a comma here
// would reach submitMonth's Number() parse as NaN.
function wholeNum(n: number): string {
  return formatHours(n);
}

// Live client-side counterpart to a section's 4 derived cells (Hours Worked,
// Hours Left, New ETC, Diff). Hours Worked Month is read-only display (it
// auto-syncs from Power BI — see instrumentation.ts) but still rides along
// in the form submission via a hidden input, since submitMonth reads it by
// `name` unchanged. New ETC recomputes client-side as Hours Worked changes
// between syncs, so Hours Left/New ETC/Diff stay in sync without waiting for
// the next Submit or Sync round-trip.
export function EtcSectionCells({
  entryId,
  jobId,
  sectionCode,
  billingGroup,
  edge,
  jobName,
  sectionName,
  priorEtc,
  initialWorked,
  initialDraft,
  initialConfirmed,
  locked,
  monthComplete,
}: {
  // NULL when this job/section has no EtcEntry yet.
  //
  // startMonth seeds one row per section the job was QUOTED for, so a section it
  // was never quoted for had no row — and the grid printed a dead "—" in all five
  // of its columns. 357 of July's 754 cells were like that (2026-08-03), so a
  // manager could not plan a section simply because nobody had quoted it, even
  // with work happening there.
  //
  // Now every cell is editable and the row is CREATED on save if a value is
  // typed. Prior ETC and Hours Worked are 0 for these, which is exactly what they
  // are — no prior estimate, no time booked yet.
  entryId: number | null;
  // Which job this cell belongs to and which rollup block it feeds. Used to
  // publish the cell's live figures (lib/etc-live-totals.ts) so the row totals,
  // the grand-total row and the Standard Sheet can move as you type — and, when
  // entryId is null, to name the field the create-on-save path reads.
  jobId: number;
  sectionCode: string;
  billingGroup: "Engineering" | "Shop";
  edge: string;
  jobName: string;
  sectionName: string;
  priorEtc: number;
  initialWorked: number;
  initialDraft: number | null;
  // The entry's confirmed New ETC when it was already submitted once (a
  // REOPENED month) — null on a first-pass month. Without this, a reopened
  // cell seeded blank (worked > 0) or with priorEtc (worked == 0), so a
  // no-changes resubmit posted those seeds as overrides and silently
  // replaced the manager's confirmed values — found 2026-07-14, where 135
  // of April's 366 cells had a worked==0 manager override != priorEtc that
  // a round-trip would have wiped.
  initialConfirmed: number | null;
  locked: boolean;
  // False while the month's actuals are still incomplete (Paylocity not yet
  // refreshed through month-end). When false we do NOT auto-fill the New ETC
  // carry-forward — the cell stays blank until the month is complete, so a
  // partial-month value never looks final. Submit still falls back to the
  // suggestion, so nothing is lost.
  monthComplete?: boolean;
}) {
  // Hours Worked Month is no longer manager-editable — it auto-syncs from
  // Power BI on the same cadence as the rest of the live sync (see
  // instrumentation.ts), so a manual edit would just get overwritten anyway.
  //
  // The hidden form input must carry the EXACT stored value, not the rounded
  // display text: submitMonth writes this value back to hoursWorked, so
  // posting the display rounding would permanently replace every fractional
  // Power-BI-synced value (e.g. 40.33) with its integer on each Submit —
  // manufacturing drift against the source that the history reconcile would
  // then keep flagging. Rounding is display-only.
  const worked = round2(initialWorked);
  const workedDisplay = wholeNum(initialWorked);
  // Hoisted out of the useState initializer because the unsaved-changes
  // tracker needs the same value as its baseline — the cell is "dirty" only
  // when what's in it differs from what it loaded with, so both have to read
  // from one expression or they'd drift apart.
  // Hours show as WHOLE numbers everywhere in the app (ui/format.ts), but this
  // cell is an <input> and seeded itself with the stored Decimal verbatim — so
  // the New ETC column printed 93.75, 410.57, 15.48 while every figure around it,
  // including the totals that sum this very cell, was rounded. Rounded on the way
  // in (2026-08-03, by request) so what is displayed, what is submitted, and what
  // carries into next month's Prior ETC are all the same number.
  const whole = (n: number) => String(Math.round(n));
  const initialText =
    initialDraft != null
      ? whole(initialDraft)
      : initialConfirmed != null
        ? whole(initialConfirmed)
        : // A cell with NO row yet starts blank, never auto-filled (2026-08-03).
          //
          // The carry-forward below fires when nothing was worked, which is true
          // of every not-yet-created cell — and its Prior ETC is 0, so all ~350 of
          // them rendered a literal "0" instead of an empty box. They then posted
          // newEtcCreate__…=0 on submit, so Submit tried to create a row for every
          // unquoted section in one transaction and timed out. There is also
          // nothing to carry forward here by definition: no prior estimate exists.
          entryId == null
          ? ""
          : monthComplete !== false && initialWorked === 0
            ? whole(priorEtc)
            : "";
  const [newEtcText, setNewEtcText] = useState(initialText);

  const hoursLeft = calcHoursLeft(priorEtc, worked);
  const suggested = suggestNewEtc(priorEtc, worked);
  // A cell only needs manager attention (yellow) when this section actually
  // logged hours this month (worked > 0) and no value has been decided yet.
  // With no hours worked, New ETC just carries the prior forward — no decision
  // needed — so it stays neutral even while the month is still in progress.
  // "Decided" is a property of what the cell CONTAINS, not of whether it was
  // ever typed in. It used to latch on a `newEtcTouched` flag that never
  // cleared, so filling a cell and then emptying it again left it neutral —
  // a section with hours worked and no New ETC, looking done. Reading the
  // current value instead means the yellow comes straight back when the value
  // goes, which is the state the manager is actually in.
  const hasNewEtcValue = newEtcText.trim() !== "";
  // ── A REOPENED month asks the same questions again ─────────────────────────
  //
  // On a reopen every cell arrives carrying the value it was submitted with
  // (initialConfirmed), so `hasNewEtcValue` is true everywhere and the whole grid
  // rendered as decided. The manager lost the one thing the yellow is for: which
  // cells actually need a judgement call this pass.
  //
  // So a previously-confirmed cell with hours worked goes yellow again — even
  // though it is filled in, and even though a manager filled it (2026-08-03, by
  // request). Re-opening a month is re-reviewing it; a cell that needed attention
  // the first time needs it again.
  //
  // It clears the moment the value is CHANGED, not merely visited, so the colour
  // works as a checklist: yellow means "still holding last submission's number",
  // grey means "I have looked at this and moved it". Keeping the same figure is a
  // valid answer — retype it, or just submit, since Submit takes what is in the
  // box either way.
  //
  // `locked` excluded: a submitted month nobody has reopened is finished, and
  // painting it all yellow would be shouting at a closed book.
  const reopenedUntouched =
    !locked && initialConfirmed != null && newEtcText.trim() === whole(initialConfirmed);
  const decided = worked === 0 || (hasNewEtcValue && !reopenedUntouched);
  const newEtcNum = Number(newEtcText);
  const effective = newEtcText.trim() === "" || !Number.isFinite(newEtcNum) ? suggested : newEtcNum;
  // Live for every cell, typed or not (2026-08-02, by request). It used to
  // render "—" until a manager typed a New ETC, which meant the column was
  // blank across most of the grid for most of the month and hid the one thing
  // it exists to show: a section that has already burned past its Prior ETC.
  //
  // With the cell blank, `effective` is the suggestion — so the number reads 0
  // while there are hours left, and turns into the overrun only once Hours Left
  // goes negative (suggestNewEtc clamps at 0, Hours Left doesn't). An untouched
  // cell is therefore quiet unless it's genuinely overspent.
  //
  // Matches newEtcDiff() server-side, so this cell, the row totals and the KPI
  // cards all still count the same set.
  // Diff reads an EMPTY New ETC as 0, and a typed one as max(value, 0)
  // (2026-08-03, by request) — matching newEtcDiff() server-side exactly, which
  // is what keeps this cell, the row totals, the grand total and the KPI cards
  // counting the same thing.
  //
  // Deliberately NOT `effective`: that still falls back to the suggestion because
  // it is what the month would submit as, and next month's Prior ETC carries from
  // it. The two answer different questions — "what is planned" vs "what has been
  // decided" — and only the second one belongs in a variance column.
  // An UNDECIDED cell contributes NOTHING — matching newEtcDiff() server-side, so
  // this cell, the row totals, the grand total and the KPI cards all count one
  // set. It used to subtract 0 here, which made Diff equal Hours Left and fed
  // that same figure into the "unplanned" KPI split.
  const diff = hasNewEtcValue ? hoursLeft - Math.max(effective, 0) : 0;

  // ── What the row PRINTS, as opposed to what it computes ────────────────────
  //
  // Reported 2026-08-03: "a lot of values are wrong based on the formulae".
  // Audited across July's 398 hours cells — the maths is right everywhere
  // (stored Hours Left matches Prior − Worked, and Diff never violated
  // Hours Left − New ETC). What was wrong was the PRINTING.
  //
  // Prior ETC is always a whole number; Hours Worked is not (129 of 398 cells
  // carry a fraction, straight from the punch feed). Rounding each cell on its
  // own then breaks the visible subtraction whenever Worked lands on exactly
  // x.5 — and the 18 rows that looked wrong were exactly the 18 x.5 cells:
  //
  //     job 1118 ME Gen — exact 40 − 1.5 = 38.5
  //     printed          — 40 − 2 = 39      (both halves rounded UP)
  //
  // So the derived cells are printed from the printed inputs, not rounded
  // independently. Because Prior is whole, that makes every row satisfy both
  // formulas exactly, as a reader checking the arithmetic expects.
  //
  // The EXACT values above are untouched and are what gets published to the
  // totals, submitted, and reconciled against Power BI — only these three
  // strings change. A column total is therefore still the rounded exact sum
  // rather than the sum of the rounded cells, which can differ by a few hours
  // (measured: 4h Engineering, 1h Shop for July). That is deliberate: the totals
  // are what reconcile to the model, and normal practice for rounded reporting.
  // Both figures remain exact in the cell tooltips.
  const workedRounded = Math.round(worked);
  const hoursLeftShown = Math.round(priorEtc) - workedRounded;
  // Empty string, not a number, when nothing has been decided — see `diff` above.
  const diffShown = hasNewEtcValue ? hoursLeftShown - Math.round(Math.max(effective, 0)) : null;

  // An existing row is addressed by its entry id; one that does not exist yet is
  // addressed by job + section, and saveAllNewEtcDrafts/submitMonth create it.
  // Two prefixes rather than one overloaded name, so a malformed id can never be
  // mistaken for a create instruction.
  const fieldName = entryId != null ? `newEtcOverride__${entryId}` : `newEtcCreate__${jobId}__${sectionCode}`;
  // Stable key for the live-totals store, which cannot use an id that has not
  // been assigned yet.
  const cellKey = entryId != null ? String(entryId) : `${jobId}:${sectionCode}`;

  // Register the value this cell LOADED with, so the unsaved-changes guards
  // can tell an actual edit from a keystroke that was undone. Unregistering on
  // unmount is what makes a month switch reset the guard: the grid form is
  // keyed on the month, so every cell here is torn down and takes its entry
  // in the tracker with it.
  //
  // Mount effect, not render: registering during render would be a side
  // effect, and a change event can't fire before mount anyway. `newEtcText` is
  // intentionally not a dependency — this captures the INITIAL value once, and
  // re-running it on every keystroke would make the baseline chase the edits
  // and nothing would ever read as dirty.
  useEffect(() => {
    registerEtcField(fieldName, initialText);
    return () => forgetEtcField(fieldName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldName]);

  // Publish this cell's live figures for the totals that sum it — the row's
  // TOTAL (NEW ETC) block, the grand-total row, and the Standard Sheet's
  // Total ETC $ / % Total / Standard Fees chain.
  //
  // The values published are the ones computed ABOVE for this cell's own
  // display, so a total can never show something the cell it sums doesn't. That
  // is the whole safety argument: this page is what Submit ETC freezes, and a
  // live total derived by some second formula would be worse than a stale one.
  //
  // In an effect rather than during render: publishing mutates a module store,
  // and a render React discards must not be allowed to change what other
  // components read.
  useEffect(() => {
    publishEtcCell(cellKey, { jobId, billingGroup, prior: priorEtc, worked, hoursLeft, effective, diff, decided: hasNewEtcValue });
  }, [cellKey, jobId, billingGroup, priorEtc, worked, hoursLeft, effective, diff, hasNewEtcValue]);

  // Unmount is what makes a month switch or a column filter self-cleaning: the
  // grid is keyed on the month, so every cell tears down and takes its
  // contribution to the totals with it.
  useEffect(() => {
    return () => forgetEtcCell(cellKey);
  }, [cellKey]);

  function handleNewEtcChange(e: React.ChangeEvent<HTMLInputElement>) {
    setNewEtcText(e.target.value);
    // Nothing persists from typing alone — the toolbar's Save button batch-
    // saves every currently-typed value across the grid at once. This just
    // reports the current value so the "unsaved changes" guards know whether
    // anything actually differs from what was loaded. Typing a value and then
    // putting the cell back how it was leaves the grid clean.
    updateEtcField(fieldName, e.target.value);
  }

  return (
    <>
      <td className={`${edge} ${ETC_COL_W} overflow-hidden bg-[#5E91D3] px-1 py-1 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-700`} title={String(round2(priorEtc))}>
        {wholeNum(priorEtc)}
      </td>
      <td
        className={`border-l border-sdc-border ${ETC_COL_W} ${HOURS_WORKED_BG} overflow-hidden px-1 py-1 text-center align-middle text-[10px] whitespace-nowrap text-sdc-navy`}
        title={String(worked)}
      >
        {/* Read-only — auto-synced from Power BI, not manager-editable. The
            hidden input still carries the value into the form submission,
            since submitMonth reads it by `name` unchanged. */}
        {/* Only a real row has hours to submit back. A not-yet-created cell has
            no hours by definition, and posting a hoursWorked field for an id that
            does not exist would be meaningless. */}
        {entryId != null && <input type="hidden" name={`hoursWorked__${entryId}`} value={String(worked)} />}
        {workedDisplay}
      </td>
      <td
        className={`border-l border-sdc-border ${ETC_COL_W} ${HOURS_LEFT_BG} overflow-hidden px-1 py-1 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-500`}
        title={`${round2(hoursLeft)} = Prior ETC (${round2(priorEtc)}) − Hours Worked (${worked})`}
      >
        {wholeNum(hoursLeft)}
      </td>
      <td className={`border-l border-sdc-border ${ETC_COL_W} ${newEtcBg(decided)} px-1 py-1 text-center align-middle whitespace-nowrap`}>
        {/* No hours worked -> carry-forward is deterministic, safe to auto-fill.
            Hours worked > 0 -> a manager's judgment call, not auto-filled;
            flagged yellow so it's obviously not done yet — left with no
            placeholder hint (rather than showing the suggestion) so the cell
            reads as genuinely blank until the manager types a value. Typing
            does NOT autosave — nothing persists until the toolbar's Save
            button (password-gated) batch-saves the whole grid at once. */}
        <input
          type="number"
          // Whole hours — the column displays and submits integers (see
          // initialText). A 0.01 step invited the decimals this fixed.
          step="1"
          min="0"
          name={fieldName}
          value={newEtcText}
          onChange={handleNewEtcChange}
          disabled={locked}
          aria-label={`New ETC override, ${jobName}, ${sectionName}`}
          className="w-full [appearance:textfield] rounded-md border-none bg-transparent px-1.5 py-0 text-center text-[10px] font-bold leading-none text-sdc-gray-600 outline-none placeholder:font-bold placeholder:text-sdc-gray-600 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:bg-white focus:shadow-sm"
        />
      </td>
      <td
        className={`border-l border-sdc-border ${ETC_COL_W} ${diffShown == null ? "bg-white" : diffBg(diffShown)} overflow-hidden px-1 py-1 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-700`}
        // The tooltip is where an EMPTY cell explains itself — there is no number
        // to hover, so it says why, and what would happen on submit anyway.
        title={
          hasNewEtcValue
            ? `${round2(diff)} = Hours Left (${round2(hoursLeft)}) − New ETC (${round2(Math.max(effective, 0))})`
            : `No New ETC entered yet, so there is nothing to compare against and no variance to report. ` +
              `Hours Left is ${round2(hoursLeft)}; submitting as-is would use the suggestion, ${round2(suggested)}.`
        }
      >
        {diffShown == null ? "" : wholeNum(diffShown)}
      </td>
    </>
  );
}
