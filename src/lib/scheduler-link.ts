import "server-only";
import { fetchSchedulerProjectJobNumbers } from "./scheduler-db";

// Browser-reachable base URL of the SDC Scheduler app. The link is clicked in
// the user's browser, so it must use the LAN hostname (users reach ETC at
// server-app1:3010 and the Scheduler at server-app1:4003) — NOT localhost.
// Override with SCHEDULER_BASE_URL in .env if the host/port ever changes.
const DEFAULT_SCHEDULER_BASE_URL = "http://server-app1:4003";

export function getSchedulerBaseUrl(): string {
  return (process.env.SCHEDULER_BASE_URL || DEFAULT_SCHEDULER_BASE_URL).replace(/\/+$/, "");
}

// The Scheduler SPA reads ?job=<etcJobId>&view=schedule on boot, resolves the
// project whose projects.job_number matches, opens it, and switches to the
// schedule view (see SDC_Scheduler public/app.js init()).
export function schedulerScheduleUrl(baseUrl: string, jobId: string): string {
  return `${baseUrl}/?job=${encodeURIComponent(jobId)}&view=schedule`;
}

// One lookup per page render: the base URL plus the set of ETC job numbers that
// actually have a Scheduler project, so grids show the "open in Scheduler" icon
// only where it leads somewhere. Fail-soft — an unconfigured/unreachable
// Scheduler DB yields an empty set (no icons), never an error.
export async function getSchedulerLinkContext(): Promise<{ baseUrl: string; jobNumbers: Set<string> }> {
  const jobNumbers = await fetchSchedulerProjectJobNumbers();
  return { baseUrl: getSchedulerBaseUrl(), jobNumbers };
}
