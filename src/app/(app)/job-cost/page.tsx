import { PageTitle } from "@/components/ui/Typography";
import { listDashboardJobs } from "@/lib/job-hours-dashboard";
import { getJobBom, type JobBom } from "@/lib/job-bom";
import { JobCostPicker } from "@/components/JobCostPicker";
import { JobBomMatrix } from "@/components/JobBomMatrix";
import { EmptyState } from "@/components/ui/EmptyState";

// "Job Cost" — native recreation of the Power BI "Job Status, Job" BOM cost
// hierarchy. Single job, expandable assembly/part tree with rolled-up costs
// pulled live from the Assembly table in the Power BI dataset (see job-bom.ts).
export default async function JobCostPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const { job } = await searchParams;
  const jobs = await listDashboardJobs();
  const selected = job && jobs.some((j) => j.jobId === job) ? job : (jobs[0]?.jobId ?? "");

  let bom: JobBom | null = null;
  let failed = false;
  if (selected) {
    try {
      bom = await getJobBom(selected);
    } catch (e) {
      // Don't leak a raw DAX/Power BI error to the manager — log it server-side
      // and show a friendly "source unavailable" card instead.
      console.error(`getJobBom failed for job ${selected}:`, e);
      failed = true;
    }
  }

  return (
    <div className="w-full p-6 md:p-8">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-4">
        <PageTitle>Job Cost</PageTitle>
        <div className="flex items-center gap-2">
          <span className="text-xs text-sdc-gray-500">Job</span>
          <JobCostPicker jobs={jobs} selected={selected} />
        </div>
      </div>
      <p className="mb-5 text-sm text-sdc-gray-600">
        Bill-of-materials cost hierarchy — assemblies and parts with rolled-up costs and quantities, pulled live from Total ETO via Power BI.
      </p>

      {!selected ? (
        <EmptyState title="No jobs available" message="Sync jobs from the Dashboard to populate this list." />
      ) : failed ? (
        <EmptyState
          tone="warning"
          title="Job Cost is temporarily unavailable"
          message="The BOM couldn't be loaded from Total ETO / Power BI right now. This is usually a brief upstream hiccup — try again in a moment, or run Sync from the Dashboard."
        />
      ) : bom && bom.roots.length ? (
        <JobBomMatrix bom={bom} />
      ) : (
        <EmptyState title="No BOM found for this job" message="This job has no assembly/part records in Total ETO." />
      )}
    </div>
  );
}
