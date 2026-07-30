"use client";

import { useState } from "react";

// Currency grid cell for the Projects tab's Cost Quoted / Cost Actual columns.
//
// Replaces a bare <input type="number">, which cannot show thousands separators
// at all — a seven-figure quote rendered as "1300000" and had to be counted by
// eye. Shows "1,300,000" at rest and the plain number while you're editing it,
// because commas that reshuffle under the caret as you type are worse than no
// commas.
//
// Two inputs, deliberately: the visible one is unnamed and never submitted, and
// a hidden field carries the raw digits under `name`. That keeps the server
// contract exactly what it was — a plain numeric string — rather than depending
// on the action to strip formatting. (parseMoney tolerates separators anyway, so
// a pasted "$1,300,000" survives, but this way the happy path never relies on it.)
export function MoneyCell({
  name,
  defaultValue,
  ariaLabel,
  className,
}: {
  name: string;
  // Raw numeric string, e.g. "1300000". Empty for "no figure on file".
  defaultValue: string;
  ariaLabel: string;
  className?: string;
}) {
  const [raw, setRaw] = useState(defaultValue);
  const [editing, setEditing] = useState(false);

  // Grouping only — no currency symbol (the cell already prints a "$" beside
  // this) and no forced decimals, so a whole-dollar quote stays whole.
  const display = (() => {
    if (raw === "") return "";
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw; // mid-typing junk: show it, don't eat it
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  })();

  return (
    <>
      <input type="hidden" name={name} value={raw} />
      <input
        type="text"
        // decimal, not numeric: numeric hides the minus/decimal keys on mobile.
        inputMode="decimal"
        value={editing ? raw : display}
        aria-label={ariaLabel}
        className={className}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          // Accept separators as they're typed or pasted, but store digits only,
          // so the hidden field is always submit-ready.
          setRaw(e.target.value.replace(/[$\s,]/g, ""));
        }}
        onBlur={() => setEditing(false)}
      />
    </>
  );
}
