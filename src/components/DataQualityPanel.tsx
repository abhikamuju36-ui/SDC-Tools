"use client";

import Link from "next/link";
import { card } from "@/components/ui/classnames";
import { SectionTitle } from "@/components/ui/Typography";
import type { DataQuality, PunchExplorer } from "@/lib/data-quality";
import { DataQualityExplorer } from "@/components/DataQualityExplorer";
import { DataQualityDrill, EmployeeIdDrill } from "@/components/DataQualityDrill";
import { hours as fmtHours } from "@/components/ui/format";

// The Power BI report's "Data Quality" page. Its rules — which punches count as
// invalid, and why — are reproduced in lib/data-quality.ts, where each one is
// traced back to the measure it came from.
//
// Shaped as findings rather than as the report's one big filterable punch table:
// that table is a tool for someone already hunting, and this is the tab a
// manager opens to be told whether there's anything to hunt for. Each check
// states its rule, its size, and the rows behind it.

const fmtH = (n: number) => `${fmtHours(n)}h`;

function Finding({
  title,
  rule,
  count,
  hours,
  unit,
  children,
}: {
  title: string;
  rule: string;
  count: number;
  hours: number;
  unit: string;
  children?: React.ReactNode;
}) {
  const clean = count === 0;
  return (
    <div className={`${card("p-5")} ${clean ? "" : "border-sdc-yellow"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-heading text-base font-bold tracking-tight text-sdc-navy">{title}</p>
          {/* The rule in plain words. A finding nobody can check is a finding
              nobody acts on — and these came from someone else's model, so the
              definition travels with the number. */}
          <p className="mt-1 text-xs leading-relaxed text-sdc-muted">{rule}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`font-heading text-2xl font-bold tabular-nums ${clean ? "text-sdc-green-text" : "text-sdc-yellow-text"}`}>
            {count.toLocaleString()}
          </p>
          <p className="text-label font-semibold text-sdc-gray-400">
            {unit}
            {hours > 0 && ` · ${fmtH(hours)}`}
          </p>
        </div>
      </div>
      {clean ? (
        <p className="mt-3 text-xs font-medium text-sdc-green-text">Nothing to review.</p>
      ) : (
        <div className="mt-3">{children}</div>
      )}
    </div>
  );
}

export function DataQualityPanel({ dq, explorer }: { dq: DataQuality; explorer: PunchExplorer | null }) {
  return (
    <div className="space-y-5">
      <div className={card("p-5")}>
        <SectionTitle>Data Quality</SectionTitle>
        <p className="mt-1 text-xs leading-relaxed text-sdc-muted">
          The punch checks from the Power BI report&apos;s Data Quality page, run against this app&apos;s own hours data. Everything is
          judged against <strong>Hours Refreshed Thru</strong>
          {dq.refreshedThrough ? (
            <>
              {" "}
              — currently <strong>{dq.refreshedThrough}</strong>
            </>
          ) : (
            " (not yet known — the hours feed has never completed)"
          )}
          , not against today&apos;s date, so a punch counts as &quot;future&quot; when it is dated beyond what payroll has actually published.
        </p>
      </div>

      {/* The report's own layout first — cards, slicers, punch table, chart —
          then the findings, which are what you look at when you don't already
          know what you're hunting for. */}
      {explorer && <DataQualityExplorer data={explorer} />}

      <Finding
        title="Hours logged in the future"
        rule="Punches dated after Hours Refreshed Thru. Usually a mistyped year or a timesheet entered against the wrong week."
        count={dq.future.count}
        hours={dq.future.hours}
        unit="punches"
      >
        <DataQualityDrill rows={dq.future.rows} />
      </Finding>

      <Finding
        title="Hours on a completed job"
        rule="Punches dated after a job's Complete Date, excluding sections 70, 80 and 90 — warranty and service work after handover is expected, everything else means the job is still absorbing cost after it was closed."
        count={dq.afterCompletion.count}
        hours={dq.afterCompletion.hours}
        unit="punches"
      >
        <DataQualityDrill rows={dq.afterCompletion.rows} showCompleted />
      </Finding>

      <Finding
        title="Unrecognised employee IDs"
        rule="Payroll IDs that appear on punches but match nobody on the roster. Their hours still count toward job totals, but nobody can be asked about them — usually a leaver who was never imported, or an ID typed into the wrong field."
        count={dq.undefinedEmployees.count}
        hours={dq.undefinedEmployees.hours}
        unit="IDs"
      >
        {/* Drillable: an unrecognised ID is only actionable once you can see
            what it has been booking to. */}
        <EmployeeIdDrill ids={dq.undefinedEmployees.ids} />
      </Finding>

      {/* "Hours booked to a non-job" (the report's "Job Id Not Defined" case) used to
          have its own finding and table here, reading the same HoursImportIssue rows
          the ETC page's own card already showed under a different name. Consolidated
          onto that one location (2026-08-20, by request) rather than left duplicated. */}
      <p className="rounded-lg border border-sdc-border bg-sdc-gray-50 px-4 py-3 text-xs leading-relaxed text-sdc-gray-600">
        Hours booked to something that isn&apos;t a usable job number (the report&apos;s &quot;Job Id Not Defined&quot; case) are
        tracked on the <Link href="/etc" className="font-semibold text-sdc-blue hover:underline">ETC page</Link>&apos;s{" "}
        <strong>Data Quality — Undefined Hours</strong> card, one month at a time, rather than duplicated here.
      </p>

      {dq.truncated && (
        <p className="text-xs text-sdc-gray-400">
          Some lists are capped at 200 rows — the counts above are complete, the tables are not.
        </p>
      )}

      <p className="rounded-lg border border-sdc-border bg-sdc-gray-50 px-4 py-3 text-xs leading-relaxed text-sdc-gray-600">
        <strong>One check from the report is missing.</strong> Its &quot;Section-Function Exception&quot; case flags punches on a
        section-function code marked invalid upstream. This app&apos;s hours import discards punches on codes it doesn&apos;t model
        before they reach the database, so there is no row left here to flag. Making that check possible means keeping those
        discarded punches at import time.
      </p>
    </div>
  );
}
