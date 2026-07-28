// Shared money/hours formatters — one source of truth instead of the four
// identical `usd()` copies that had drifted across chart/table components.
// Values are byte-identical to those copies, so nothing changes on screen.

export function usd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// Up-to-2-decimals (e.g. "$5" or "$5.25") — matches PartsCostSection's old usd2.
export function usd2(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

// Whole hours with thousands separators.
export function hours(n: number): string {
  return Math.round(n).toLocaleString();
}
