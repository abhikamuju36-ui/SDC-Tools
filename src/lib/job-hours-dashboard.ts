import { prisma } from "@/lib/prisma";
import { SECTIONS, ETC_SECTIONS, PHASE_GROUPS, PARTS_COST_SECTION } from "@/lib/sections";
import { suggestNewEtc } from "@/lib/etc";
import { validJobTypeFilter, compareJobIds } from "@/lib/job-filters";
import { loadActualHoursBySection, loadMonthlyWorkedBySection } from "@/lib/actual-hours";

// Data layer for the "Job Hour Details" dashboard — a web recreation of the
// Power BI "Job Hours Report — Management Level" drillthrough page. Sources every
// hours metric from the ETC app's own data (EstimatedHours = Quoted, EtcEntry =
// Actual + ETC), so it needs no Power BI connection.

export type HoursType = "Quoted" | "ETC";

export type SectionHours = {
  code: string;
  name: string;
  phase: string;
  group: string;
  billingGroup: "Engineering" | "Shop";
  quoted: number;
  etc: number;
  actual: number;
};

// Engineering vs Shop split — READ from sections.ts's own ETC_SECTIONS.billingGroup
// rather than a second, hand-copied code list (found live, 2026-08-20: this used to
// re-type sections.ts's private ENGINEERING_CODES set, which could silently drift
// from the real one with no compiler warning — exactly the "signed-off number
// disagrees across screens" failure class this app has hit before).
const BILLING_GROUP_BY_CODE = new Map(ETC_SECTIONS.map((s) => [s.code, s.billingGroup]));
const billingGroupOf = (code: string): "Engineering" | "Shop" => BILLING_GROUP_BY_CODE.get(code) ?? "Shop";

export type JobHoursDashboard = {
  job: { id: number; jobId: string; jobName: string; customer: string | null; status: string };
  // The individual jobs this view aggregates (1+). Used to pull parts cost.
  jobRefs: { id: number; jobId: string }[];
  kpis: {
    hoursRefreshedThru: string | null;
    latestEtcMonth: string | null;
    // There was a `designToDebugRatio` here — the PBI DAX measure (Section 10
    // Engineering actual / Section 40 Engineering actual, blank under 200 debug
    // hours). Its card was removed from the header row in §57 and nothing read the
    // field afterwards, so it was removed in §66 rather than left computing a
    // figure with no consumer. The section-level `actual` hours it derived from are
    // untouched and still drive the charts.
  };
  sections: SectionHours[];
  phaseGroups: { phase: string; count: number }[];
  billingGroups: { group: string; quoted: number; etc: number; actual: number }[];
  // Per-section month-by-month worked hours, oldest first — the detail behind a
  // section's Actual bar. Keyed by section code; a section with no ETC history
  // is absent rather than present-and-empty. Feeds the drill-through panel: the
  // charts could say a section was 680 hours over, but not when that happened,
  // which is the first thing anyone asks next.
  monthlyBySection: Record<string, { month: string; worked: number }[]>;
};

// Effective New ETC — the same rule the ETC grid renders with (execution-etc.ts).
function effectiveNewEtc(e: {
  needsReview: boolean; newEtc: unknown; newEtcDraft: unknown; priorEtc: unknown; hoursWorked: unknown;
}): number {
  if (!e.needsReview) return Number(e.newEtc);
  if (e.newEtcDraft != null) return Number(e.newEtcDraft);
  return suggestNewEtc(Number(e.priorEtc), Number(e.hoursWorked));
}

export async function listDashboardJobs(): Promise<{ id: number; jobId: string; jobName: string; status: string }[]> {
  const jobs = await prisma.job.findMany({
    where: { ...validJobTypeFilter },
    select: { id: true, jobId: true, jobName: true, status: true },
  });
  return jobs.sort((a, b) => compareJobIds(a.jobId, b.jobId));
}

// Pick a sensible default job for first load: the one with the most worked
// hours in the latest ETC month (so the dashboard opens on real data instead of
// an empty service/spare-parts job).
export async function defaultDashboardJobId(): Promise<number | null> {
  const latest = await prisma.etcEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
  if (!latest) return null;
  const grouped = await prisma.etcEntry.groupBy({
    by: ["jobId"],
    where: { month: latest.month },
    _sum: { hoursWorked: true },
  });
  grouped.sort((a, b) => Number(b._sum.hoursWorked ?? 0) - Number(a._sum.hoursWorked ?? 0));
  const validIds = new Set((await listDashboardJobs()).map((j) => j.id));
  for (const g of grouped) if (validIds.has(g.jobId)) return g.jobId;
  return null;
}

// Accepts one or more internal Job ids and aggregates the hours dashboard
// across them (sections, billing groups, KPIs are summed) — the same way the
// Power BI job slicer combines multiple jobs.
export async function getJobHoursDashboard(jobIdOrIds: number | number[]): Promise<JobHoursDashboard | null> {
  const ids = Array.isArray(jobIdOrIds) ? jobIdOrIds : [jobIdOrIds];
  const jobs = await prisma.job.findMany({
    where: { id: { in: ids } },
    select: { id: true, jobId: true, jobName: true, customer: true, status: true },
  });
  if (jobs.length === 0) return null;
  jobs.sort((a, b) => compareJobIds(a.jobId, b.jobId));
  const jobIds = jobs.map((j) => j.id);

  const [estimated, entries, actualBySection, monthlyBySection, freshness, latestEntry] = await Promise.all([
    // Quoted only — actuals come from actual-hours.ts below.
    prisma.estimatedHours.findMany({ where: { jobId: { in: jobIds } }, select: { section: true, quotedHours: true } }),
    prisma.etcEntry.findMany({
      where: { jobId: { in: jobIds } },
      select: { section: true, month: true, hoursWorked: true, newEtc: true, newEtcDraft: true, priorEtc: true, needsReview: true },
    }),
    // Actuals and their monthly timeline come from actual-hours.ts, not from
    // `entries` above: EtcEntry.hoursWorked is frozen once a month closes, so
    // reading it here understated every closed month by the late punches booked
    // since (6,954h across Jan–Jul 2026). `entries` is still what drives ETC,
    // which must keep using the frozen figure.
    loadActualHoursBySection(jobIds),
    loadMonthlyWorkedBySection(jobIds),
    prisma.powerBiFreshness.findUnique({ where: { source: "hours_actual" }, select: { refreshedThrough: true } }).catch(() => null),
    prisma.etcEntry.findFirst({ where: { jobId: { in: jobIds } }, orderBy: { month: "desc" }, select: { month: true } }),
  ]);

  // Combined display when more than one job is selected.
  const job =
    jobs.length === 1
      ? jobs[0]
      : {
          id: jobs[0].id,
          jobId: jobs.map((j) => j.jobId).join(", "),
          jobName: `${jobs.length} jobs selected`,
          customer: null as string | null,
          status: "—",
        };
  const jobRefs = jobs.map((j) => ({ id: j.id, jobId: j.jobId }));

  const latestMonth = latestEntry?.month ?? null;

  // Quoted per section.
  const quotedBy = new Map<string, number>();
  for (const e of estimated) quotedBy.set(e.section, (quotedBy.get(e.section) ?? 0) + Number(e.quotedHours));

  // Cumulative actual per section, summed across the selected jobs. The rule
  // (migration snapshot + frozen ETC history + live punches) lives in
  // actual-hours.ts so this page and the Projects grid can't disagree.
  const actualBy = new Map<string, number>();
  for (const sections of actualBySection.values()) {
    for (const [section, hours] of sections) actualBy.set(section, (actualBy.get(section) ?? 0) + hours);
  }

  // ETC per section — effective New ETC for the latest month only.
  const etcBy = new Map<string, number>();
  if (latestMonth) {
    for (const e of entries) {
      if (e.month !== latestMonth || e.section === PARTS_COST_SECTION) continue;
      etcBy.set(e.section, (etcBy.get(e.section) ?? 0) + effectiveNewEtc(e));
    }
  }

  const sections: SectionHours[] = SECTIONS.map((s) => ({
    code: s.code,
    name: s.name,
    phase: s.phase,
    group: s.group,
    billingGroup: billingGroupOf(s.code),
    quoted: quotedBy.get(s.code) ?? 0,
    etc: etcBy.get(s.code) ?? 0,
    actual: actualBy.get(s.code) ?? 0,
  }));

  // Billing-group rollups (Engineering / Shop).
  const bgMap = new Map<string, { quoted: number; etc: number; actual: number }>();
  for (const s of sections) {
    const cur = bgMap.get(s.billingGroup) ?? { quoted: 0, etc: 0, actual: 0 };
    cur.quoted += s.quoted; cur.etc += s.etc; cur.actual += s.actual;
    bgMap.set(s.billingGroup, cur);
  }
  const billingGroups = ["Engineering", "Shop"].map((g) => ({ group: g, ...(bgMap.get(g) ?? { quoted: 0, etc: 0, actual: 0 }) }));

  return {
    job,
    jobRefs,
    kpis: {
      hoursRefreshedThru: freshness?.refreshedThrough ? freshness.refreshedThrough.toISOString().slice(0, 10) : null,
      latestEtcMonth: latestMonth,
    },
    sections,
    phaseGroups: PHASE_GROUPS,
    billingGroups,
    monthlyBySection,
  };
}
