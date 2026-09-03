// ── When the Parts Cost breakout columns exist ───────────────────────────────
//
// "Left to Invoice" and "Left to Purchase" split the Parts Cost New ETC into the two
// things it is made of. They were added 2026-09-03, and the instruction with them was
// explicit: they start at August 2026 and must not appear on any earlier month.
//
// ── Why a month rule and not just "show them everywhere" ────────────────────
//
// Because the columns would be empty and misleading on every closed month, in a way
// that reads as data loss rather than as a feature that did not exist yet. Nothing
// backfills them: they are manager-entered figures stored per EtcEntry, so every month
// before August has NULL in both, and NULL renders as "—". A manager opening June
// would see two new columns of dashes beside a New ETC that was in fact submitted and
// signed off — inviting them to "fix" a month that is already closed.
//
// The same reasoning applies to the upstream cost. Left to Invoice is seeded from Total
// ETO, and that is the only upstream call the Monthly ETC page makes; there is no
// reason to spend it on a month that cannot show the result.
//
// ── Why a constant and not a "does any row have a value" check ──────────────
//
// A data-driven test would make the columns appear and disappear depending on whether
// anyone had typed in them yet — so August itself would show no columns until the first
// manager filled one in, and could not be filled in because the columns were not there.
// The rule is a date because the decision was a date.

/**
 * The first month that has these columns, `YYYY-MM`.
 *
 * August 2026, by request. Month strings in this app are zero-padded `YYYY-MM`
 * throughout, which is why a plain string comparison below is sound.
 */
export const PARTS_BREAKOUT_FIRST_MONTH = "2026-08";

/**
 * Whether the Monthly ETC grid shows Left to Invoice / Left to Purchase for `month`.
 *
 * Anything unparseable answers false — the columns are additive, so the safe direction
 * for a month string we do not understand is the layout every month had before this
 * feature existed.
 */
export function showsPartsBreakout(month: string | null | undefined): boolean {
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;
  return month >= PARTS_BREAKOUT_FIRST_MONTH;
}
