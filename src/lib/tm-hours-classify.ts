import { ETC_SECTIONS, POOL_QUOTED_SECTION } from "@/lib/sections";

// ── The T&M Hours code->card classifier, split out on purpose ───────────────
//
// Pure and dependency-free (no Prisma, no "server-only") so it's importable
// from a plain node:test file without a database — `tm-hours.ts` itself has
// `import "server-only"`, which throws unconditionally under this project's
// test runner (tsx) the moment anything VALUE-imports it, so the one thing
// worth testing without a live database (the code->card mapping itself) has
// to live somewhere that import doesn't reach. Same reasoning as
// tm-drill-reconcile.ts's own split from tm-report.ts.
//
// getTmHoursTotals (an aggregate) and getTmHoursDrillRows (row detail) in
// tm-hours.ts both run every JobHoursDetail row through this SAME function —
// so a card's KPI total and its own drill-through can only ever disagree if
// this function disagreed with itself between two calls, which it can't
// (pure, depends on nothing but its argument).
//
//   Engineering / Shop — ETC_SECTIONS' `billingGroup`, the exact map
//     etc-month-kpis.ts's `SECTION_GROUP` builds from (sections.ts).
//   PM / Manufacturing — the single codes `poolCategoryForPunch` (sections.ts)
//     already treats as canonical for these two buckets, exposed as
//     POOL_QUOTED_SECTION.ENGINEERING_PM ("10-111") and
//     .SHOP_MANUFACTURING ("10-413"). Deliberately NOT
//     hours-operational-grouping.ts's broader "Manufacturing" task tier
//     (which also folds in Spare Parts' 90-414) — sections.ts's own comment
//     on SECTION_ALIASES documents that counting 414 outside phase 10 runs
//     ~40h/month above the figure the team actually signed off on.

export type TmHoursDrillKey = "engineeringHours" | "shopHours" | "pmHours" | "manufacturingHours";

export const ENGINEERING_HOURS_CODES = new Set(ETC_SECTIONS.filter((s) => s.billingGroup === "Engineering").map((s) => s.code));
export const SHOP_HOURS_CODES = new Set(ETC_SECTIONS.filter((s) => s.billingGroup === "Shop").map((s) => s.code));
export const PM_HOURS_CODE = POOL_QUOTED_SECTION.ENGINEERING_PM;
export const MANUFACTURING_HOURS_CODE = POOL_QUOTED_SECTION.SHOP_MANUFACTURING;

export const ALL_TM_HOURS_CODES: readonly string[] = [
  ...ENGINEERING_HOURS_CODES,
  ...SHOP_HOURS_CODES,
  PM_HOURS_CODE,
  MANUFACTURING_HOURS_CODE,
];

export const HOURS_CODES_BY_KEY: Record<TmHoursDrillKey, readonly string[]> = {
  engineeringHours: [...ENGINEERING_HOURS_CODES],
  shopHours: [...SHOP_HOURS_CODES],
  pmHours: [PM_HOURS_CODE],
  manufacturingHours: [MANUFACTURING_HOURS_CODE],
};

export function classifyTmHoursSection(section: string): TmHoursDrillKey | null {
  if (section === PM_HOURS_CODE) return "pmHours";
  if (section === MANUFACTURING_HOURS_CODE) return "manufacturingHours";
  if (ENGINEERING_HOURS_CODES.has(section)) return "engineeringHours";
  if (SHOP_HOURS_CODES.has(section)) return "shopHours";
  return null;
}
