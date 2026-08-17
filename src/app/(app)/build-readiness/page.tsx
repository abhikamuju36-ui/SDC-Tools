import { PageTitle } from "@/components/ui/Typography";
import { getBuildReadinessData, triggerBuildReadinessRefresh } from "@/lib/build-readiness-actions";
import { listBuildReadinessViews } from "@/lib/build-readiness-views-actions";
import { BuildReadinessDashboard } from "@/components/build-readiness/BuildReadinessDashboard";

// "Build Readiness" — cross-project view of what can actually be built right
// now, across every active billable job, backed by the exact same
// getJobBom()/job-bom-rules.ts readiness logic Job Hour Details -> Procurement
// already uses (see build-readiness-sync.ts's own header). Numbers here are
// never a second formula — a job's readiness % is only ever as current as its
// last live Build Readiness pass, same as Procurement is only as current as
// the page load that fetched it.
//
// The page itself kicks off a live refresh on first load if the cached
// snapshot is missing or stale (see triggerBuildReadinessRefresh) — the
// client then polls for progress. This starts it BEFORE the first paint so a
// cold cache doesn't wait an extra client round-trip to begin.
export default async function BuildReadinessPage() {
  await triggerBuildReadinessRefresh(false);
  const [data, views] = await Promise.all([getBuildReadinessData(), listBuildReadinessViews()]);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Build Readiness</PageTitle>
      <p className="-mt-2 text-sm text-sdc-gray-500">
        What can be built right now, what&apos;s blocked and why, and what upcoming deliveries unlock next — across every active billable project.
      </p>
      <BuildReadinessDashboard initialData={data} initialViews={views} />
    </div>
  );
}
