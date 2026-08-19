// Job Status vocabulary shared between the two hiring position sources
// (2026-08-19) — the Job.xlsx workbook's own free-text "Job Status"/"Job Sub
// Status" columns, and HiringPositionCreated's fixed vocabulary for
// positions made inside SDC Reports. Dependency-free so both server code and
// client components (the status filter, the Create Position form) import the
// same list.
//
// The live workbook (inspected 2026-08-19) currently carries exactly one
// value, "Published" — this Paylocity export appears to already be scoped to
// currently-open requisitions, so there is no observed "Filled"/"Cancelled"
// text to confirm against. CLOSED_STATUS_KEYWORDS stays a generic keyword
// match (not a hardcoded list of specific statuses) so a differently-worded
// closed status the export starts including later — or a manually-created
// position's own status below — is still classified correctly without a
// code change.
const CLOSED_STATUS_KEYWORDS = ["filled", "closed", "cancelled", "canceled", "withdrawn", "expired", "on hold"];

/**
 * Whether a position (from EITHER source) should count as currently open —
 * the one function driving hiring/planned-headcount totals for both. Checked
 * on status AND sub-status text (not just archived) so a recruiter marking a
 * requisition Filled/Cancelled in the text still stops it counting even if
 * the row hasn't been archived yet.
 */
export function isOpenHiringStatus(status: string, subStatus: string | null, archived: boolean): boolean {
  if (archived) return false;
  const s = status.toLowerCase();
  const sub = (subStatus ?? "").toLowerCase();
  return !CLOSED_STATUS_KEYWORDS.some((k) => s.includes(k) || sub.includes(k));
}

// The fixed vocabulary for a position CREATED in SDC Reports — unlike the
// workbook, nothing external dictates these, so they're validated at write
// time rather than merely displayed. "Open" is the only one isOpenHiringStatus
// above treats as open; the other three all match a CLOSED_STATUS_KEYWORDS
// entry by construction, so they fall out of hiring/planned-headcount totals
// the same way a Filled/Cancelled workbook row would, with no special-casing.
export const MANUAL_JOB_STATUSES = ["Open", "On Hold", "Filled", "Cancelled"] as const;
export type ManualJobStatus = (typeof MANUAL_JOB_STATUSES)[number];
export const DEFAULT_MANUAL_JOB_STATUS: ManualJobStatus = "Open";

export function isManualJobStatus(value: string): value is ManualJobStatus {
  return (MANUAL_JOB_STATUSES as readonly string[]).includes(value);
}
