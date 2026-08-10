// A job must have a real Type to ever be imported or shown — Custom, Duplicate,
// Hybrid, Service, or T&M. Jobs with no Type (e.g. TotalETO has no Type field at
// all) are noise and must never appear in any list, count, dashboard, or export.
//
// "T&M" (time & materials) added 2026-08-03, by request. This list is the ONE
// place types are declared — the Projects Type dropdown, the Type filter, the
// new-project validator and the type-gate on every job query all read it — so
// adding it here is the whole change. Note the gate widens with it: any job
// already stored as T&M (which was previously unreachable noise) becomes visible
// app-wide from this commit on. That is the intent.
export const VALID_JOB_TYPES = ["Custom", "Duplicate", "Hybrid", "Service", "T&M"] as const;

export const validJobTypeFilter = { type: { in: [...VALID_JOB_TYPES] } };

// The job lifecycle, in order. Declared here rather than derived from whatever
// distinct values happen to be in the database, which is how it used to work:
// the Status dropdown listed only statuses already in use, so a new one could
// never be picked in the first place.
//
// "HeadStart" — we intend to start, but there is no PO yet. Deliberately its own
// state rather than an Active job with a flag: it changes what the job means to
// every reader (no PO, so no billing, and a missing Start Date is expected
// rather than a data error).
export const JOB_STATUSES = ["Active", "HeadStart", "Complete"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// What the Projects grid shows when nobody has chosen a Status filter. HeadStart
// is included on purpose: a manager who sets a job to HeadStart and watches the
// row vanish from the default view would reasonably conclude the app lost it.
export const DEFAULT_VISIBLE_STATUSES: JobStatus[] = ["Active", "HeadStart"];

// A HeadStart job has no PO, so no hours can be booked against it and it has no
// ETC to plan — it stays out of the Monthly ETC month below (status: "Active"
// only). That also leaves the ENG/SHOP totals the team signed off untouched.
// If HeadStart work does start getting booked, this is the line to revisit.

// The one job universe the Monthly ETC month operates on — the grid, seeding,
// pruning, and submission must all use this same filter, or entries get seeded
// for jobs the grid never renders and the month can never be submitted.
// `billable: true` added 2026-08-03, by request: an Active NON-billable job must
// never appear on the Monthly ETC grid. Internal work (SDC Showroom, Non-Billable,
// Team Initiatives, Spare Parts, StateLogic…) is not planned job-by-job, so it was
// only ever noise on a sheet about billable estimates — and it fed the Engineering
// and Shop totals the team signs off.
//
// The stored flag is enough on its own: isSdcCustomer forces billable=false on
// save, and no SDC-customer job is currently stored as billable (checked
// 2026-08-03), so there is no second rule to keep in step here.
//
// This is the ONE universe the month operates on, so excluding them here excludes
// them from seeding, pruning and submission too — which is the point. Two
// consequences worth knowing: pruneStaleEntries will delete their existing
// unsubmitted rows on the next Refresh (215.5 July hours across 1083/4000/6000/
// 7000), and those hours then surface on the "Hours off the grid" KPI card, which
// is exactly what that card is for. The punch rows in JobHoursDetail are untouched,
// so the Projects grid and Job Hour Details still count them.
// ── Eligibility vs lifecycle (2026-08-10) ───────────────────────────────────
//
// The two halves of the rule above, separated, because a SUBMITTED month must
// re-apply one of them and must NOT re-apply the other.
//
// ELIGIBILITY (here) — non-billable and HeadStart. These say the job was never a
// Monthly ETC project in the first place: internal work (SDC Showroom, 4000
// Non-Billable, 7000 Team Initiatives, the Spare Parts buckets) is not planned
// job-by-job, and a HeadStart job has no PO to bill against. Nothing about the
// passage of time makes such a job retroactively belong on a month's grid, so
// this half applies to EVERY month, submitted ones included.
//
// LIFECYCLE (etcActiveJobFilter below) — `status: "Active"` and `completeDate`.
// These move on their own as work finishes. A job that was legitimately on July's
// grid and COMPLETED in August is still part of July's history, so re-applying
// this half to a closed month would erase real submitted work — the exact
// regression getEtcMonthJobWhere's entries-based branch exists to prevent.
//
// Splitting them is what lets a locked month keep its completed jobs while still
// excluding the ones that never qualified. See getEtcMonthJobWhere.
export const etcEligibleJobFilter = { billable: true, status: { not: "HeadStart" }, ...validJobTypeFilter };

// The one job universe the LIVE Monthly ETC month operates on — the grid, seeding,
// pruning and submission all use this. Eligibility PLUS lifecycle: `status: "Active"`
// deliberately overrides the `not: "HeadStart"` above with the stricter test.
export const etcActiveJobFilter = { ...etcEligibleJobFilter, status: "Active", completeDate: null };

// SDC's own internal projects are never billable to an outside customer — this
// overrides whatever the Billable dropdown is set to, both when saving and for
// any job already in the database. "SDC" and "Steven Douglas Corp." are the
// same company (SDC = Steven Douglas Corporation), so both spellings count —
// they get the same non-billable rule and the same light-blue row highlight.
export function isSdcCustomer(customer: string | null | undefined): boolean {
  const normalized = (customer ?? "").trim().toUpperCase();
  return normalized === "SDC" || normalized.startsWith("STEVEN DOUGLAS");
}

// Job Ids are stored as strings but are (almost always) numbers — a plain
// string sort puts "10000" before "979". Sort numerically like the sheet did,
// falling back to string comparison for any non-numeric Id.
export function compareJobIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}
