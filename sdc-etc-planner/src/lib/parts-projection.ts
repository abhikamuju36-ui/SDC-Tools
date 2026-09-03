import type { PartsCostLine } from "@/lib/sync-totaleto";

// ── Parts Cost projection: Dan's model ───────────────────────────────────────
//
// Specified 2026-09-03 from Dan's sketch, and it supersedes every earlier version
// of this calculation. The rule:
//
//   Start with the PRIOR month's ETC, reduce it by what was actually spent on parts
//   this month, compare what is left against the external exposure still to be
//   invoiced, and add only the uncovered difference.
//
//     adjustedEtc        = max(0, priorEtc - partsSpentThisMonth)
//     yetToInvoice       = eligible external remaining exposure (excludes in-house SDC)
//     additionalExposure = max(0, yetToInvoice - adjustedEtc)
//     totalProjection    = invoiced + adjustedEtc + additionalExposure
//                        = invoiced + max(adjustedEtc, yetToInvoice)
//
// The bar reads, bottom to top: invoiced (blue), adjustedEtc (yellow),
// additionalExposure (red, and only when there is any).
//
// ── What this replaced ──────────────────────────────────────────────────────
//
// Three earlier attempts, each recorded because each shipped:
//
//   1. `invoiced + max(committedNotPosted, submittedEtc)` — climbed dollar-for-dollar
//      with invoicing, because `invoiced` was live while the submitted ETC did not
//      shrink to match.
//   2. A frozen submission baseline — held still, but had to be reconstructed for
//      historical months and the reconstruction was wrong by $715,000 on the first
//      job it met.
//   3. `invoiced + toComplete`, with the CURRENT month's submitted ETC splitting the
//      remainder into covered and uncovered.
//
// (3) is closest, and two things separate it from this model. It used the current
// month's submitted New ETC where Dan starts from the PRIOR month's and draws it
// down by this month's spend (§20 is explicit that the two must not be confused).
// And its total was the whole open PO balance, where this one excludes in-house SDC
// exposure — work that never produces an external supplier invoice (§6).
//
// ── Why the total is still stable under normal conversion (§13) ─────────────
//
// An invoice landing does two things: `invoiced` rises, and the same dollars leave
// `yetToInvoice`. In the regime where `yetToInvoice` is the larger term, the total
// `invoiced + yetToInvoice` therefore does not move. In the regime where
// `adjustedEtc` is larger, the invoice also raises `partsSpentThisMonth`, which
// draws `adjustedEtc` down by the same amount — so the total holds there too. The
// stability is a consequence of the model rather than something pinned on top of it,
// which is what makes it trustworthy: nothing is snapshotted, so nothing can be
// reconstructed wrongly.

// ── In-house SDC (§6) ───────────────────────────────────────────────────────
//
// Dan: "do not include In-house SDC" in the remaining external invoice exposure —
// it is work SDC does itself, so no supplier invoice is ever coming for it, and
// counting it as exposure overstates what the job still owes the outside world.
//
// The classification is on MANUFACTURER, and deliberately not on supplier. Measured
// across jobs 1101/1104/1131 (5,000 lines): manufacturer carries "SDC" (2,011 lines)
// and "SDC ASSY" (1). The supplier field's /sdc/i matches are
// "SDC Credit Card (Approved)" (19) and "Reconciling With Sage - SDC" (5) — those are
// PAYMENT MECHANISMS for genuine outside purchases, and excluding them would drop
// real external exposure from the figure.
//
// There is no canonical classification column to read instead: `manufacturer === "SDC"`
// is what the Parts List itself renders as "In-house (SDC)" (JobProcurement.tsx), so
// this is the same rule that display already applies, lifted into one named
// predicate rather than string-matched a second time at a second call site.
//
// The match is on a word boundary rather than equality so "SDC ASSY" is caught,
// while a hypothetical outside vendor like "SDCO Inc" is not.
const IN_HOUSE_MANUFACTURER = /^SDC(\s|$)/;

export function isInHouseSdc(line: Pick<PartsCostLine, "manufacturer">): boolean {
  return IN_HOUSE_MANUFACTURER.test((line.manufacturer ?? "").trim().toUpperCase());
}

/** One row's remaining exposure, on the app's canonical basis. */
export function rowLeftToInvoice(line: Pick<PartsCostLine, "totalPrice" | "actualAmount">): number {
  // `actualAmount` (GL-posted), NOT `invoicedAmount` (billed) — the same expression
  // PartsCostDrill's own rows use and the same basis the card's job-level figure is
  // built on (§17, source consistency). Measured on job 1101 the two definitions
  // differ by $19,498: $61,126 against $41,628. Using the wrong one here would put
  // the card, the Parts List and this projection on three different footings.
  return line.totalPrice - line.actualAmount;
}

export type YetToInvoice = {
  /** Eligible external exposure — the figure the projection compares against the ETC. */
  amount: number;
  /** Remaining exposure on in-house SDC rows, excluded from `amount`. Reported, not hidden. */
  inHouseExcluded: number;
  /** How many rows were classified in-house, so the exclusion is auditable. */
  inHouseRows: number;
  /** Every row's exposure including in-house — what the card's "Left to be invoiced" has always shown. */
  allRows: number;
};

/**
 * Remaining external invoice exposure for a job's parts lines.
 *
 * Floored at zero on the AGGREGATE, not per row, which is the existing job-wide
 * convention (a line whose posted spend exceeds its purchased total is a credit, and
 * it should net against its neighbours rather than being clamped away individually).
 */
export function computeYetToInvoice(lines: readonly PartsCostLine[]): YetToInvoice {
  let all = 0;
  let inHouse = 0;
  let inHouseRows = 0;
  for (const l of lines) {
    const left = rowLeftToInvoice(l);
    all += left;
    if (isInHouseSdc(l)) {
      inHouse += left;
      inHouseRows++;
    }
  }
  const allFloored = Math.max(0, all);
  const eligible = Math.max(0, all - inHouse);
  return {
    amount: eligible,
    inHouseExcluded: allFloored - eligible,
    inHouseRows,
    allRows: allFloored,
  };
}

// ── The projection ──────────────────────────────────────────────────────────

export type PartsProjection = {
  /** Blue. GL-posted spend against the job, lifetime. */
  invoiced: number;
  /** The previous month's submitted New ETC — the forecast this month starts from. */
  priorEtc: number | null;
  /** This month's canonical parts spend, the amount the prior forecast is drawn down by. */
  partsSpentThisMonth: number;
  /** `priorEtc - partsSpentThisMonth`, which CAN be negative. Kept for the drill-through. */
  adjustedEtcRaw: number | null;
  /** Yellow. The same figure floored at 0, because a bar cannot have negative height. */
  adjustedEtc: number;
  /** Eligible external exposure still to be invoiced. */
  yetToInvoice: number;
  /** Red. `max(0, yetToInvoice - adjustedEtc)` — exposure the adjusted forecast does not cover. */
  additionalExposure: number;
  /** The bar's height: `invoiced + adjustedEtc + additionalExposure`. */
  totalProjection: number;
  /** Where the dotted line goes: `invoiced + adjustedEtc`. Null when there is no red to bound. */
  coverageLine: number | null;
  hasAdditionalExposure: boolean;
  /** True when no prior ETC could be resolved at all — see the reader for when that happens. */
  etcUnknown: boolean;
};

const num = (n: number | null | undefined): number =>
  typeof n === "number" && Number.isFinite(n) ? n : 0;

export function computePartsProjection(input: {
  invoiced: number;
  priorEtc: number | null;
  partsSpentThisMonth: number;
  yetToInvoice: number;
}): PartsProjection {
  const invoiced = num(input.invoiced);
  const partsSpentThisMonth = num(input.partsSpentThisMonth);
  const yetToInvoice = Math.max(0, num(input.yetToInvoice));
  const etcKnown = input.priorEtc != null && Number.isFinite(input.priorEtc);
  const priorEtc = etcKnown ? (input.priorEtc as number) : null;

  // §3: the raw figure is kept for diagnostics, and only the DRAWN one is floored.
  // A negative adjusted ETC is real information — the month has already spent past
  // its own forecast — and the drill-through says so rather than rounding it away.
  const adjustedEtcRaw = priorEtc == null ? null : priorEtc - partsSpentThisMonth;
  const adjustedEtc = adjustedEtcRaw == null ? 0 : Math.max(0, adjustedEtcRaw);

  // §7 and §16: only the UNCOVERED difference is added. Adding the whole
  // `yetToInvoice` on top of `adjustedEtc` would count the covered portion twice.
  const additionalExposure = Math.max(0, yetToInvoice - adjustedEtc);
  const totalProjection = invoiced + adjustedEtc + additionalExposure;

  return {
    invoiced,
    priorEtc,
    partsSpentThisMonth,
    adjustedEtcRaw,
    adjustedEtc,
    yetToInvoice,
    additionalExposure,
    totalProjection,
    // §12: the line marks where ETC coverage ends, so it only means something when
    // there is exposure above it. §7 forbids drawing it otherwise.
    coverageLine: additionalExposure > 0 ? invoiced + adjustedEtc : null,
    hasAdditionalExposure: additionalExposure > 0,
    etcUnknown: priorEtc == null,
  };
}
