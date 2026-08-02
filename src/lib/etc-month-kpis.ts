import "server-only";
import { prisma } from "@/lib/prisma";
import { ETC_SECTIONS, PARTS_COST_SECTION } from "@/lib/sections";
import { calcHoursLeft, round2, effectiveNewEtc, newEtcDiff } from "@/lib/etc";

// KPI cards for the top of the Monthly ETC page: hours worked and variance for
// Engineering and Shop, parts money spent, and how many people booked time in
// each group.
//
// The hours/variance figures are computed from the SAME EtcEntry rows the grid
// already has in memory, with the same effective-New-ETC rule and the same
// billing-group split, so a card can never disagree with the grand-total row at
// the bottom of the grid. That's the whole reason this takes the rows as an
// argument instead of re-querying: a second query would be a second definition,
// and the two would drift the first time someone changed a rule.
//
// Headcount is the one figure that needs its own read, because the grid doesn't
// carry it: it comes from JobHoursDetail (the punch-level Paylocity rows added
// 2026-07-30), counting DISTINCT employees per billing group.

const SECTION_GROUP = new Map(ETC_SECTIONS.map((s) => [s.code, s.billingGroup]));

export type GroupKpi = {
  prior: number;
  worked: number;
  hoursLeft: number;
  newEtc: number;
  // Sum of the per-cell variances across EVERY cell — newEtcDiff is live for
  // all of them now, so an untouched cell contributes 0 unless its section is
  // already overspent, in which case it contributes the overrun.
  diff: number;
  people: number; // distinct employees who booked time in this group this month
};

export type EtcMonthKpis = {
  engineering: GroupKpi;
  shop: GroupKpi;
  parts: { prior: number; spent: number; moneyLeft: number; newEtc: number; diff: number };
  // Distinct people across both groups — NOT engineering.people + shop.people,
  // since anyone who booked to both would otherwise be counted twice.
  peopleTotal: number;
  // False when JobHoursDetail holds nothing for this month, so the cards can say
  // "no punch data" rather than showing a confident zero.
  hasPunchData: boolean;
};

// The entry shape both this and the grid rely on. Structural, so the caller can
// pass its Prisma rows straight through.
type EntryLike = {
  section: string;
  priorEtc: unknown;
  hoursWorked: unknown;
  newEtc: unknown;
  newEtcDraft: unknown;
  needsReview: boolean;
};


export async function getEtcMonthKpis(
  month: string,
  // Exactly the jobs the grid is rendering (i.e. after its Billable filter), so
  // the cards move with the grid rather than describing a different set.
  jobs: { id: number; etcEntries: EntryLike[] }[],
): Promise<EtcMonthKpis> {
  // Summed PER CELL, not derived from the group totals: the suggestion that
  // stands in for an untouched cell clamps at 0 per cell, and that clamp cannot
  // be reproduced from the sums. Every cell counts now — see newEtcDiff.
  const eng = { prior: 0, worked: 0, newEtc: 0, diff: 0 };
  const shop = { prior: 0, worked: 0, newEtc: 0, diff: 0 };
  const parts = { prior: 0, spent: 0, newEtc: 0, diff: 0 };

  for (const job of jobs) {
    for (const entry of job.etcEntries) {
      if (entry.section === PARTS_COST_SECTION) {
        parts.prior += Number(entry.priorEtc);
        parts.spent += Number(entry.hoursWorked);
        parts.newEtc += effectiveNewEtc(entry);
        parts.diff += newEtcDiff(entry);
        continue;
      }
      const group = SECTION_GROUP.get(entry.section);
      if (!group) continue; // a code the ETC grid doesn't track
      const bucket = group === "Engineering" ? eng : shop;
      bucket.prior += Number(entry.priorEtc);
      bucket.worked += Number(entry.hoursWorked);
      bucket.newEtc += effectiveNewEtc(entry);
      bucket.diff += newEtcDiff(entry);
    }
  }

  // Headcount, per group and overall, from the punch rows. Restricted to the
  // same jobs so it can't count someone who only booked to a job the grid is
  // filtering out.
  const jobIds = jobs.map((j) => j.id);
  const punches = jobIds.length
    ? await prisma.jobHoursDetail.findMany({
        where: { month, jobId: { in: jobIds } },
        select: { section: true, employeeId: true },
      })
    : [];
  const engPeople = new Set<string>();
  const shopPeople = new Set<string>();
  const allPeople = new Set<string>();
  for (const p of punches) {
    if (!p.employeeId) continue;
    allPeople.add(p.employeeId);
    const group = SECTION_GROUP.get(p.section);
    if (group === "Engineering") engPeople.add(p.employeeId);
    else if (group === "Shop") shopPeople.add(p.employeeId);
  }

  const finish = (
    b: { prior: number; worked: number; newEtc: number; diff: number },
    people: number,
  ): GroupKpi => {
    const hoursLeft = calcHoursLeft(b.prior, b.worked);
    return {
      prior: round2(b.prior),
      worked: round2(b.worked),
      hoursLeft: round2(hoursLeft),
      newEtc: round2(b.newEtc),
      diff: round2(b.diff),
      people,
    };
  };

  const partsLeft = calcHoursLeft(parts.prior, parts.spent);
  return {
    engineering: finish(eng, engPeople.size),
    shop: finish(shop, shopPeople.size),
    parts: {
      prior: round2(parts.prior),
      spent: round2(parts.spent),
      moneyLeft: round2(partsLeft),
      newEtc: round2(parts.newEtc),
      diff: round2(parts.diff),
    },
    peopleTotal: allPeople.size,
    hasPunchData: punches.length > 0,
  };
}
