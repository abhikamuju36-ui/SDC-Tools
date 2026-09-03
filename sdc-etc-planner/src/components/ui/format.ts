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

// ── Exactly two decimals (§39.13) ───────────────────────────────────────────
//
// "$5.00", never "$5". This is the precise figure behind a rounded one — the title
// attribute on a money cell, the Parts Cost value a manager is typing into — where
// dropping a trailing ".00" makes the reader wonder whether they are looking at the
// rounded number again.
//
// It exists because ELEVEN call sites had written their own currency formatter, in
// three shapes: six copies of usd()'s options, and five of these. Two of the three
// files even called them the same names (`currency` / `currencyExact`), which is
// duplication with a straight face. §39.13 asks for consistent decimal precision and
// consistent symbol placement; the only way to have that is one definition each.
export function usdExact(n: number): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Whole hours with thousands separators. Hours are ALWAYS displayed rounded
// across the app — the grids, the KPI cards, the charts and the drill tables all
// come through here or an equivalent, so a figure never changes shape depending
// on which screen it's read from.
export function hours(n: number): string {
  return Math.round(n).toLocaleString();
}

// Whole hours for a single row of punch detail, where the value can legitimately
// be a fraction of an hour. Same rounding as hours(), except a real but sub-half
// punch renders as "<1" instead of "0": a 0.3-hour booking is work someone did,
// and printing "0" against their name says the opposite. Pair it with a title
// carrying the exact figure (see hoursExact).
export function hoursCell(n: number): string {
  if (n > 0 && Math.round(n) === 0) return "<1";
  if (n < 0 && Math.round(n) === 0) return ">-1";
  return Math.round(n).toLocaleString();
}

// The unrounded value, for tooltips — so the exact number is always reachable
// even though the cell shows a rounded one.
export function hoursExact(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
