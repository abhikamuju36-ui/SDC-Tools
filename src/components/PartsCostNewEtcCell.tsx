"use client";

import { useState } from "react";
import { markEtcDirty } from "@/lib/etc-dirty-tracker";

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
//   * markEtcDirty() on change so the beforeunload "unsaved changes" guard
//     covers Parts Cost too.
// Currency masking (plain digits while focused, "$X,XXX" once blurred) is kept
// from the old EtcDraftInput currency mode; the raw digits ride along in a
// hidden input under `name`, so Save/Submit parse a clean number.
export function PartsCostNewEtcCell({
  name,
  jobName,
  initialValue,
  attentionWhenBlank,
  hint,
  locked,
}: {
  name: string;
  jobName: string;
  initialValue: string;
  // True when a blank cell here means "someone still has to decide this": money
  // was spent this month, and the month is neither submitted nor historical.
  // Whether a value is PRESENT is judged from the input itself, so clearing a
  // cell brings the yellow straight back.
  attentionWhenBlank: boolean;
  // Tooltip only — deliberately NOT a placeholder. A placeholder here renders
  // bold in the same grey as a real value, so an untouched cell read as a
  // decided one; see the call site in etc/page.tsx.
  hint?: string;
  locked?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [focused, setFocused] = useState(false);

  // Decided = this cell holds a value RIGHT NOW. Not "was typed in at some
  // point": a latching touched-flag left an emptied cell looking settled when
  // it no longer was. Same rule as EtcSectionCells.
  const decided = !attentionWhenBlank || value.trim() !== "";
  const displayValue = focused ? value : value.trim() === "" ? "" : currency(Number(value));

  return (
    <td className={`border-l border-sdc-border ${decided ? NEUTRAL_BG : ATTENTION_BG} px-1 py-1 text-center`}>
      <input type="hidden" name={name} value={value} disabled={locked} />
      <input
        type="text"
        inputMode="decimal"
        value={displayValue}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setValue(e.target.value.replace(/[^0-9.]/g, ""));
          // Nothing persists from typing alone — the toolbar's gated Save
          // button batch-saves the whole grid. This just flags unsaved work
          // for the beforeunload guard.
          markEtcDirty();
        }}
        onBlur={() => setFocused(false)}
        title={hint}
        disabled={locked}
        aria-label={`New ETC cost override, ${jobName}, Parts Cost`}
        className="w-16 [appearance:textfield] rounded-md border-none bg-transparent px-1.5 py-0 text-center text-[10px] font-bold leading-none text-sdc-gray-600 outline-none placeholder:font-bold placeholder:text-sdc-gray-600 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:bg-white focus:shadow-sm"
      />
    </td>
  );
}
