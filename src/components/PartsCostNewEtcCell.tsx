"use client";

import { useEffect, useState } from "react";
import { registerEtcField, forgetEtcField, updateEtcField, adoptEtcFieldBaseline } from "@/lib/etc-dirty-tracker";
import { PARTS_COL_W } from "@/components/ui/classnames";
import { publishPartsCell, forgetPartsCell } from "@/lib/etc-live-totals";
import { isNewEtcCellDecided, formatNewEtcText, type NewEtcCellState } from "@/lib/etc";
import { useRemoteEtcValue, forgetRemoteEtcValue } from "@/lib/etc-remote-values";
import { useCellSaveState, cellSaveStateStyle } from "@/lib/etc-save-state";
import { CellPresence } from "@/components/CellPresence";
import { beginEditingCell, endEditingCell } from "@/components/RealtimeProvider";

const NEUTRAL_BG = "bg-[#F2F2F2]";
const ATTENTION_BG = "bg-[#FAFAC4]";

function currency(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// Parts Cost's New ETC cell. Deliberately mirrors the New ETC cell in
// EtcSectionCells rather than reusing EtcDraftInput:
//   * NO autosave on blur — typing persists nothing on its own. The whole grid
//     is one <form>; the toolbar's (password-gated) Save button batch-saves
//     every `newEtcOverride__<id>` field at once. The old blur-autosave here
//     bypassed that gate, which was the one inconsistency in the column.
//   * Live "needs attention" background — yellow only when money was actually
//     spent this month and no value is decided yet; clears the instant the
//     manager types (touched), exactly like the section-hours cells.
//   * NO placeholder. Also like the section-hours cells: money spent means the
//     next figure is a manager's call, and the cell must read as blank until
//     one is made.
//   * Reports its value to the dirty tracker on change so the "unsaved
//     changes" guards cover Parts Cost too — by value, so re-typing the
//     original figure leaves the grid clean.
// Currency masking (plain digits while focused, "$X,XXX" once blurred) is kept
// from the old EtcDraftInput currency mode; the raw digits ride along in a
// hidden input under `name`, so Save/Submit parse a clean number.
export function PartsCostNewEtcCell({
  name,
  jobId,
  priorEtc,
  spent,
  suggested,
  jobName,
  initialValue,
  cellState,
  hint,
  locked,
}: {
  name: string;
  // Published to lib/etc-live-totals.ts so this cell's dollars reach Total ETC $
  // — and through it % Total, Standard Fees and Total Standard Fees — as they are
  // typed. `suggested` is the server's own suggestNewEtc for this cell, passed in
  // rather than recomputed so the live figure and the submitted one agree.
  jobId: number;
  priorEtc: number;
  spent: number;
  suggested: number;
  jobName: string;
  initialValue: string;
  // This cell's whole state, so "is it decided" comes from the ONE rule in
  // lib/etc.ts that also colours the section-hours cells —
  // rather than the private expression this cell used to carry. That expression
  // treated any submittedAt as decided, so on a reopened month every Parts Cost
  // cell read as settled while the hours cells beside it correctly went yellow.
  //
  // All primitives, so it crosses the server/client boundary as plain data.
  // Whether a value is PRESENT is still judged from the live input below, so
  // clearing a cell by hand brings the yellow straight back.
  cellState: NewEtcCellState;
  // Tooltip only — deliberately NOT a placeholder. A placeholder here renders
  // bold in the same grey as a real value, so an untouched cell read as a
  // decided one; see the call site in etc/page.tsx.
  hint?: string;
  locked?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [focused, setFocused] = useState(false);

  // What the server last said about this cell: the prop from the last full render,
  // or a realtime change event naming this exact cell. One variable for both, so the
  // adopt rule below cannot treat them differently. The event path is the 2026-08-04
  // performance fix — the alternative was re-rendering all 4,150 cells of this page
  // (854 KB, ~600ms) to deliver one dollar figure. See lib/etc-remote-values.ts.
  const remoteRaw = useRemoteEtcValue(name);
  // Per-cell save state, same store and same vocabulary as the hours cells (§17).
  const saveState = cellSaveStateStyle(useCellSaveState(name));
  // "exact": Parts Cost is MONEY and keeps its cents, so an announced value must be
  // formatted the way this column seeds — 5819.03, not 5819.
  const serverText = remoteRaw == null ? initialValue : formatNewEtcText(remoteRaw, "exact");

  // Adopt a figure another user saved, unless this user has typed their own.
  // Identical rule to EtcSectionCells and MoneyCell — see the long note in
  // EtcSectionCells for why mount-time state was half of the multi-user bug.
  // `focused` is respected too: never move a value under an active caret.
  const [serverValue, setServerValue] = useState(serverText);
  if (serverValue !== serverText) {
    const wasClean = value === serverValue;
    setServerValue(serverText);
    if (wasClean && !focused) setValue(serverText);
  }

  // A fresh server render retires the realtime patch — a full payload is newer and
  // more complete than any single event. Same rule, same reason as EtcSectionCells.
  useEffect(() => {
    forgetRemoteEtcValue(name);
  }, [name, initialValue]);

  // Baseline for the unsaved-changes guards, and the unmount cleanup that lets
  // a month switch reset them. See EtcSectionCells for the full rationale —
  // this cell posts into the same `newEtcOverride__<id>` namespace, so it has
  // to participate the same way or Parts Cost edits would go unnoticed.
  useEffect(() => {
    registerEtcField(name, initialValue);
    return () => forgetEtcField(name);
    // initialValue is the mount-time baseline by design; see EtcSectionCells.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // When the box and the server agree, that agreement IS the baseline. Without
  // this, adopting a colleague's saved figure would leave the cell reading as
  // dirty and autosave would post it, only to have the stale-write guard reject it
  // as a conflict on a cell nobody touched. See adoptEtcFieldBaseline.
  useEffect(() => {
    // Compared against what the server last said — which is the prop, or a realtime
    // value the cell has adopted since. Using the raw prop here would leave a cell
    // that took a colleague's announced figure looking dirty, and autosave would post
    // it straight back at them.
    if (value === serverText) adoptEtcFieldBaseline(name, serverText);
  }, [name, serverText, value]);

  // Publish the live dollars for the totals downstream of this cell. Same rule as
  // EtcSectionCells: an empty or unparseable box means "not decided", which is the
  // suggestion — exactly what Submit would write.
  useEffect(() => {
    const typed = Number(value);
    const effective = value.trim() === "" || !Number.isFinite(typed) ? suggested : typed;
    const left = priorEtc - spent;
    // Diff counts a BLANK box as 0, so it reads as the money nobody has planned yet
    // (2026-08-04, by request). `effective` above still falls back to the suggestion
    // because Total ETC $ and the carry-forward depend on it — the two quantities
    // genuinely differ for an unanswered cell. Must match the server's own
    // expression in etc/page.tsx or the figure would jump on hydration.
    const decidedNow = isNewEtcCellDecided(cellState, value);
    const diffNow = left - (decidedNow ? effective : 0);
    // `decided` is published too, but the row Diff no longer prints "—" for an
    // undecided cell — it prints the figure (see diffNow above). The flag is still
    // carried because the yellow/neutral background reads from it.
    publishPartsCell(jobId, {
      prior: priorEtc,
      spent,
      left,
      newEtc: effective,
      diff: diffNow,
      decided: decidedNow,
    });
  }, [jobId, priorEtc, spent, suggested, value, cellState]);

  useEffect(() => {
    return () => forgetPartsCell(jobId);
  }, [jobId]);

  // Yellow iff money was spent this month AND the box is empty — judged from the
  // value this cell holds RIGHT NOW, so it clears on the keystroke that fills it and
  // returns on the one that empties it. "$0 more parts needed" is an answer, so a
  // typed 0 is not yellow. Literally the same function as EtcSectionCells; see
  // lib/etc.ts for the two rules that used to be one.
  const decided = isNewEtcCellDecided(cellState, value);
  const displayValue = focused ? value : value.trim() === "" ? "" : currency(Number(value));

  return (
    // `relative` so the presence marker sits in the corner without resizing the cell.
    <td
      className={`relative border-l border-sdc-border ${decided ? NEUTRAL_BG : ATTENTION_BG} ${saveState?.ring ?? ""} ${PARTS_COL_W} px-1 py-1 text-center`}
      title={saveState?.title}
    >
      <CellPresence cellKey={name} />
      <input type="hidden" name={name} value={value} disabled={locked} />
      <input
        type="text"
        inputMode="decimal"
        value={displayValue}
        // EtcAutosave's delegated listener matches on the field NAME, and this
        // visible input deliberately has none (the name is on the hidden input
        // beside it, which React updates without dispatching an input event). So
        // typing here scheduled no autosave at all and the status chip stayed idle
        // — found by review 2026-08-04. Not data loss (the visibilitychange flush
        // and the Save button both cover it), but the debounce is the thing that
        // makes a Parts Cost edit safe within a second like every other cell.
        data-etc-autosave="1"
        // The server's last value, for Escape-to-cancel (ExcelCellFocus). Raw
        // digits, matching what the hidden input posts — restoring the formatted
        // "$12,395" would put a string the save cannot parse into the box.
        data-baseline={serverValue}
        onFocus={() => {
          setFocused(true);
          // Claim the cell so other users see the indicator before they type.
          beginEditingCell({ tab: "Monthly ETC", rowRef: jobName, columnName: "Parts Cost New ETC", cellKey: name });
        }}
        onChange={(e) => {
          const next = e.target.value.replace(/[^0-9.]/g, "");
          setValue(next);
          // Nothing persists from typing alone — the toolbar's gated Save
          // button batch-saves the whole grid. This just reports the current
          // value so the guards can compare it against what was loaded.
          // `next`, not e.target.value: the stripped text is what the hidden
          // input posts, so it's what the baseline has to be compared with.
          updateEtcField(name, next);
        }}
        onBlur={() => {
          setFocused(false);
          endEditingCell(name);
        }}
        title={hint}
        disabled={locked}
        aria-label={`New ETC cost override, ${jobName}, Parts Cost`}
        className="w-full [appearance:textfield] rounded-md border-none bg-transparent px-1.5 py-0 text-center text-[10px] font-bold leading-none text-sdc-gray-600 outline-none placeholder:font-bold placeholder:text-sdc-gray-600 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:bg-white focus:shadow-sm"
      />
    </td>
  );
}
