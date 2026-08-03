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
export const etcActiveJobFilter = { status: "Active", completeDate: null, ...validJobTypeFilter };

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
