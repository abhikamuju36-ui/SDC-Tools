"use client";

import { useEffect, useState } from "react";
import { calcHoursLeft, suggestNewEtc, round2 } from "@/lib/etc";
import { registerEtcField, forgetEtcField, updateEtcField } from "@/lib/etc-dirty-tracker";
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
  entryId: number;
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
  const initialText =
    initialDraft != null
      ? String(initialDraft)
      : initialConfirmed != null
        ? String(initialConfirmed)
        : monthComplete !== false && initialWorked === 0
          ? String(round2(priorEtc))
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
  const decided = worked === 0 || hasNewEtcValue;
  const newEtcNum = Number(newEtcText);
  const effective = newEtcText.trim() === "" || !Number.isFinite(newEtcNum) ? suggested : newEtcNum;
  const diff = hoursLeft - effective;
  // Diff is only a real comparison once a manager has committed a number. With
  // the cell blank, `effective` is the suggestion — and since suggestNewEtc clamps
  // at 0 while Hours Left can be negative, an overspent cell nobody had touched
  // showed an overrun it had not earned. Matches newEtcDiff() server-side, so the
  // cell, the row total and the KPI card all count the same things.
  const diffDecided = hasNewEtcValue;

  const fieldName = `newEtcOverride__${entryId}`;

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
        <input type="hidden" name={`hoursWorked__${entryId}`} value={String(worked)} />
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
          step="0.01"
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
        className={`border-l border-sdc-border ${ETC_COL_W} ${diffDecided ? diffBg(diff) : "bg-white"} overflow-hidden px-1 py-1 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-700`}
        title={
          diffDecided
            ? `${round2(diff)} = Hours Left (${round2(hoursLeft)}) − New ETC (${round2(effective)})`
            : `No New ETC entered yet. Hours Left is ${round2(hoursLeft)}; the suggestion is ${round2(suggested)}.`
        }
      >
        {diffDecided ? wholeNum(diff) : "—"}
      </td>
    </>
  );
}
