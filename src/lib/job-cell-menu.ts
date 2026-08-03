// The attributes a grid cell carries to become right-clickable, and the selector
// the menu host finds it by.
//
// Deliberately NOT in JobCellMenuHost.tsx, even though that is the only thing
// that reads them. That file is `"use client"`, and every export of a client
// module is a client REFERENCE — so calling this from the server render of
// quoted/page.tsx or etc/page.tsx throws "Attempted to call jobCellMenuProps()
// from the server". Both call sites are server components, which is the entire
// point of the delegated menu: the cells stay server-rendered and only one
// client component exists per grid.
//
// A plain .ts module with no directive is importable from both sides.

export const JOB_MENU_ID_ATTR = "data-job-menu-id";
export const JOB_MENU_CELL_SELECTOR = `[${JOB_MENU_ID_ATTR}]`;

export function jobCellMenuProps({
  jobId,
  jobName,
  schedulerUrl,
}: {
  jobId: string;
  jobName: string;
  // Null when this job has no matching Scheduler project, so the menu never
  // offers a dead link.
  schedulerUrl: string | null;
}) {
  return {
    [JOB_MENU_ID_ATTR]: jobId,
    "data-job-menu-name": jobName,
    // Omitted entirely rather than set empty: absent means "no Scheduler
    // project", which is exactly how the menu reads it.
    ...(schedulerUrl ? { "data-job-menu-url": schedulerUrl } : {}),
  } as const;
}
