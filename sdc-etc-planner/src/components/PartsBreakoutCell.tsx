"use client";

import { useState } from "react";
import { registerEtcField, forgetEtcField, updateEtcField, adoptEtcFieldBaseline } from "@/lib/etc-dirty-tracker";
import { PARTS_COL_W } from "@/components/ui/classnames";
import { usd } from "@/components/ui/format";
import { publishPartsBreakout, forgetPartsBreakout } from "@/lib/etc-live-totals";
import { useEffect } from "react";

// ── Left to Invoice / Left to Purchase, manager-entered ──────────────────────
//
// Requested 2026-09-03. The two cells that now make up Parts Cost New ETC:
//
//     New ETC = Left to Invoice + Left to Purchase
//
// so New ETC became a read-only sum and these two are what a manager types.
//
// ── Why these are entered rather than read from Total ETO ───────────────────
//
// They were built as live figures first (lib/parts-etc-breakout.ts), and it did not
// hold up on the month-end page. The batched 49-job parts-lines query aborts under
// real page load — `[parts-etc-breakout] batched parts lines failed: Error: aborted`
// — and because the BOM half needs those lines to know which parts have already been
// bought, Left to Purchase then read **$0 on every job**. A figure that is silently
// zero is worse than one somebody typed, on a number that seeds the forecast.
//
// The live figure is not thrown away: Left to Invoice still arrives SEEDED from Total
// ETO and stays overridable, so the manager only touches it when the fetch failed or
// they disagree. Left to Purchase starts blank, by request.
//
// ── Deliberately thinner than PartsCostNewEtcCell ───────────────────────────
//
// That component carries realtime presence, remote-value adoption and a per-cell save
// ring, because New ETC is the figure two managers are most likely to edit at once. It
// is also the most complicated component in the grid. These two are inputs to it, so
// they get the parts that protect DATA — the dirty tracker, so the unsaved-changes
// guards and the autosave debounce see them — and not the parts that protect against
// collision. If two people start fighting over these cells, the presence machinery is
// the thing to lift across, and it should be lifted rather than reimplemented.
export function PartsBreakoutCell({
  name,
  initialValue,
  locked,
  jobId,
  which,
  jobName,
  seedHint,
  bg,
}: {
  /** `partsLeftToInvoice__<entryId>` or `partsLeftToPurchase__<entryId>`. */
  name: string;
  /** The stored value, or the Total ETO seed for Left to Invoice. "" renders blank. */
  initialValue: string;
  locked: boolean;
  jobId: number;
  which: "invoice" | "purchase";
  jobName: string;
  /** Where a seeded starting value came from, so an untouched cell can say so. */
  seedHint?: string;
  bg: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [focused, setFocused] = useState(false);

  // The server sent a different value (a save landed, a refresh happened). Adopt it
  // only when this box has not diverged and is not being typed in — never move a
  // value under an active caret. Same rule as PartsCostNewEtcCell's `serverValue`.
  const [serverValue, setServerValue] = useState(initialValue);
  if (serverValue !== initialValue) {
    const wasClean = value === serverValue;
    setServerValue(initialValue);
    if (wasClean && !focused) setValue(initialValue);
  }

  // Baseline for the unsaved-changes guards, and the unmount cleanup that makes a
  // month switch self-cleaning. Without this the autosave debounce never sees these
  // cells and a typed value would only persist via the Save button.
  useEffect(() => {
    registerEtcField(name, initialValue);
    return () => forgetEtcField(name);
    // initialValue is the mount-time baseline by design — see EtcSectionCells.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  useEffect(() => {
    if (value === serverValue) adoptEtcFieldBaseline(name, serverValue);
  }, [name, serverValue, value]);

  // Publish for the live New ETC sum. New ETC is a read-only cell rendered by the
  // page, so it cannot see this state — the same reason the Parts Cost row's Diff is
  // patched from a published value rather than computed in place.
  useEffect(() => {
    const n = Number(value);
    publishPartsBreakout(jobId, which, value.trim() === "" || !Number.isFinite(n) ? null : n);
    return () => forgetPartsBreakout(jobId, which);
  }, [jobId, which, value]);

  const label = which === "invoice" ? "Left to Invoice" : "Left to Purchase";
  // Formatted when idle, raw while typing — a caret must never sit inside a "$" or a
  // thousands separator.
  const display = focused ? value : value.trim() === "" ? "" : usd(Number(value));

  return (
    <td className={`motion-cell relative border-l border-sdc-border ${bg} ${PARTS_COL_W} px-1 py-1 text-center`}>
      <input type="hidden" name={name} value={value} disabled={locked} />
      <input
        type="text"
        inputMode="decimal"
        value={display}
        // EtcAutosave listens by field NAME on a delegated handler, and the visible
        // input deliberately has none — the name is on the hidden input beside it,
        // which React updates without dispatching an input event. This attribute is
        // what opts the visible box into that listener; without it typing here
        // schedules no autosave at all (the bug found on PartsCostNewEtcCell,
        // 2026-08-04).
        data-etc-autosave="1"
        // The server's last value, for Escape-to-cancel (ExcelCellFocus). Raw digits,
        // matching what the hidden input posts.
        data-baseline={serverValue}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          const next = e.target.value.replace(/[^0-9.]/g, "");
          setValue(next);
          // `next`, not e.target.value: the stripped text is what the hidden input
          // posts, so it is what the baseline must be compared against.
          updateEtcField(name, next);
        }}
        onBlur={() => setFocused(false)}
        title={
          value.trim() === "" && seedHint
            ? seedHint
            : `${label} — ${jobName}. Typed here; New ETC is the sum of this and the other column.`
        }
        disabled={locked}
        aria-label={`${label}, ${jobName}`}
        className="w-full [appearance:textfield] rounded-md border-none bg-transparent px-1.5 py-0 text-center text-label font-bold leading-none text-sdc-gray-700 outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:bg-white focus:shadow-sm"
      />
    </td>
  );
}
