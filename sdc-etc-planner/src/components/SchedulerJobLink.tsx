import { schedulerScheduleUrl } from "@/lib/scheduler-link";

// Small "open this job's schedule in the SDC Scheduler" icon-link, rendered
// next to the existing Job Hour Details chart icon on the Projects / Monthly
// ETC / Job Hour Details screens. Opens the Scheduler in a new tab, deep-linked
// to the matching project's schedule view (see lib/scheduler-link.ts).
//
// `available` gates rendering: the caller passes jobNumbers.has(job.jobId) from
// getSchedulerLinkContext(), so the icon only appears for jobs that actually
// have a Scheduler project — never a dead link. A plain <a> (not next/link):
// it's an external app on another port, always a fresh tab.
export function SchedulerJobLink({
  jobId,
  jobName,
  baseUrl,
  available,
  className,
  ssoEmail,
}: {
  jobId: string;
  jobName?: string;
  baseUrl: string;
  available: boolean;
  className?: string;
  // Passed through to the link so arriving at the Scheduler doesn't hit a login
  // modal — see scheduler-sso.ts. Omitted: the link behaves exactly as before.
  ssoEmail?: string | null;
}) {
  if (!available) return null;
  const label = `Open ${jobName ?? jobId} project schedule in the Scheduler`;
  return (
    <a
      href={schedulerScheduleUrl(baseUrl, jobId, ssoEmail)}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className={className ?? "shrink-0 text-sdc-gray-400 hover:text-sdc-blue"}
    >
      {/* Gantt-style staggered bars — deliberately distinct from the vertical
          bar-chart icon used for Job Hour Details. */}
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6">
        <line x1="2.5" y1="3.5" x2="9.5" y2="3.5" strokeLinecap="round" />
        <line x1="5.5" y1="8" x2="13.5" y2="8" strokeLinecap="round" />
        <line x1="3.5" y1="12.5" x2="10.5" y2="12.5" strokeLinecap="round" />
      </svg>
    </a>
  );
}
