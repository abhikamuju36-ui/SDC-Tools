// Pure request-shape validation for the T&M drill-through actions — split out
// from tm-drill-actions.ts because that file has `"use server"` and
// value-imports tm-report.ts (the Node-only Power BI client) and tm-hours.ts
// (`server-only` + Prisma) at module scope, either of which throws the
// moment a plain node:test file imports it (same constraint as
// tm-hours-classify.ts's own split from tm-hours.ts). This file imports
// nothing, so it's directly unit-testable.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Job ids reach either a DAX string literal (escaped by buildTmFilters) or a
// Prisma `jobId: { in: [...] }` filter (parameterized by the driver, not
// string-built) — bounded either way so a crafted request can't ask for an
// unbounded list.
export function sanitizeJobIds(jobIds: string[]): string[] {
  return jobIds.filter((s) => typeof s === "string" && s.length > 0 && s.length <= 20).slice(0, 500);
}

// Real calendar dates, not just the right shape — "2026-02-30" matches
// ISO_DATE but `new Date(...)` silently rolls it over to March 2, which would
// quietly query the wrong 24 hours rather than fail loudly.
export function isValidCalendarDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isValidDateRange(startDate: string, endDate: string): boolean {
  return isValidCalendarDate(startDate) && isValidCalendarDate(endDate);
}
