"use client";

import { useState, useTransition } from "react";
import { BuildReadinessDrawer } from "@/components/build-readiness/BuildReadinessDrawer";
import { HiringMoveToControl } from "@/components/HiringMoveToControl";
import { HiringExpectedStartDateControl } from "@/components/HiringExpectedStartDateControl";
import { workforceGroupForCardKey, workforceGroupTitle, WORKFORCE_GROUPS, type WorkforceGroupKey } from "@/lib/employee-workforce-groups";
import { EMPLOYEE_TEAMS } from "@/lib/employee-teams";
import { updateHiringPosition } from "@/lib/hiring-actions";
import { MANUAL_JOB_STATUSES, isManualJobStatus, isOpenHiringStatus } from "@/lib/hiring-position-status";
import { HiringStatusPill } from "@/components/HiringStatusPill";
import type { HiringPosition } from "@/lib/hiring-positions";

// Level 3 for a hiring position (2026-08-19). Two modes, by `position.source`:
//
// - "workbook": unchanged from before Job Status editing existed — read-only
//   fields straight off Job.xlsx (only the workbook's own "Report" sheet
//   columns are shown — see hiring-workbook-parse.ts's REQUIRED_HEADERS/type
//   for the exhaustive real column list), plus the existing Move-to control
//   for workforce group/department (the one thing this app DOES own for a
//   Paylocity-sourced position).
// - "manual": a real edit form — title/status/group/department all live on
//   this position's own HiringPositionCreated row (see that model's comment
//   in schema.prisma), so all four are editable here, not just group/dept.

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-sdc-border-soft px-4 py-2.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-sdc-muted">{label}</span>
      <span className="truncate text-sm text-sdc-navy" title={value}>
        {value}
      </span>
    </div>
  );
}

const INPUT = "h-9 w-full rounded-lg border border-sdc-border bg-white px-2.5 text-sm text-sdc-navy outline-none focus:border-sdc-blue";
const LABEL = "text-xs font-semibold uppercase tracking-wide text-sdc-muted";
const ASSIGNABLE_GROUPS = WORKFORCE_GROUPS.filter((g) => g.key !== "other");

function ManualEditForm({
  position,
  onUpdated,
  onClose,
}: {
  position: HiringPosition;
  onUpdated: (sourceId: string, patch: Partial<HiringPosition>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(position.title);
  const [jobStatus, setJobStatus] = useState(position.status);
  const [workforceGroup, setWorkforceGroup] = useState<WorkforceGroupKey>(position.workforceGroup ?? "engineering");
  const [department, setDepartment] = useState(position.department ?? "");
  const [expectedStartDate, setExpectedStartDate] = useState(position.expectedStartDate ? position.expectedStartDate.toISOString().slice(0, 10) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The four statuses, plus this position's OWN status if it somehow sits
  // outside them (a legacy value written before the vocabulary changed) --
  // otherwise a <select> with no matching option would silently rewrite it to
  // the first entry on the next save.
  const statusOptions = isManualJobStatus(position.status)
    ? (MANUAL_JOB_STATUSES as readonly string[])
    : [...MANUAL_JOB_STATUSES, position.status];

  const departmentsInGroup = EMPLOYEE_TEAMS.filter((t) => workforceGroupForCardKey(t.schedulerCode) === workforceGroup);
  const selectedDepartment = departmentsInGroup.some((t) => t.schedulerCode === department) ? department : departmentsInGroup[0]?.schedulerCode ?? "";

  function save() {
    setError(null);
    if (!title.trim()) {
      setError("Position Title is required.");
      return;
    }
    startTransition(async () => {
      const startDate = expectedStartDate ? new Date(expectedStartDate) : null;
      const result = await updateHiringPosition(position.sourceId, {
        title,
        jobStatus,
        workforceGroup,
        department: selectedDepartment,
        expectedStartDate: startDate,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onUpdated(position.sourceId, {
        title: title.trim(),
        status: jobStatus,
        // isOpenHiringStatus is the ONE rule for open-ness (Open/Published
        // open, On Hold/Filled closed). Mirroring it here rather than
        // re-testing for "Open" keeps this optimistic update identical to what
        // the server just stored -- with the old literal check, saving a
        // position as Published would have dropped it out of the hiring
        // counts on screen until the next full page load.
        isOpen: isOpenHiringStatus(jobStatus, position.subStatus, false),
        workforceGroup,
        department: selectedDepartment,
        expectedStartDate: startDate,
      });
      onClose();
    });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Position Title *</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Job Status *</span>
        <select value={jobStatus} onChange={(e) => setJobStatus(e.target.value)} className={INPUT}>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Workforce Group *</span>
        <select
          value={workforceGroup}
          onChange={(e) => {
            const next = e.target.value as WorkforceGroupKey;
            setWorkforceGroup(next);
            setDepartment("");
          }}
          className={INPUT}
        >
          {ASSIGNABLE_GROUPS.map((g) => (
            <option key={g.key} value={g.key}>
              {g.title}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Department *</span>
        <select value={selectedDepartment} onChange={(e) => setDepartment(e.target.value)} className={INPUT}>
          {departmentsInGroup.map((t) => (
            <option key={t.schedulerCode} value={t.schedulerCode}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Expected Start Date</span>
        <input type="date" value={expectedStartDate} onChange={(e) => setExpectedStartDate(e.target.value)} className={INPUT} />
      </label>
      {error && (
        <p className="text-note text-sdc-red-text" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="h-9 rounded-lg bg-sdc-blue px-3.5 text-sm font-semibold text-white motion-interactive hover:brightness-95 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

export function HiringPositionDetailDrawer({
  position,
  canAssign,
  onAssigned,
  onUpdated,
  onClose,
}: {
  position: HiringPosition;
  canAssign: boolean;
  onAssigned: (positionSourceId: string, next: { workforceGroup: WorkforceGroupKey | null; department: string | null }) => void;
  onUpdated: (sourceId: string, patch: Partial<HiringPosition>) => void;
  onClose: () => void;
}) {
  const departmentTitle = EMPLOYEE_TEAMS.find((t) => t.schedulerCode === position.department)?.name;

  return (
    <BuildReadinessDrawer
      title={position.title}
      subtitle={position.workforceGroup ? `${workforceGroupTitle(position.workforceGroup)}${departmentTitle ? ` · ${departmentTitle}` : ""}` : "Unassigned"}
      breadcrumb={["Hiring Positions", position.title]}
      onBreadcrumbClick={() => {}}
      onClose={onClose}
    >
      {position.source === "manual" && canAssign ? (
        <ManualEditForm position={position} onUpdated={onUpdated} onClose={onClose} />
      ) : (
        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-sdc-border-soft px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-sdc-muted">Move to</span>
            {position.source === "workbook" ? (
              <HiringMoveToControl
                positionSourceId={position.sourceId}
                workforceGroup={position.workforceGroup}
                department={position.department}
                canAssign={canAssign}
                onAssigned={onAssigned}
              />
            ) : (
              <span className="text-note text-sdc-muted">
                {position.workforceGroup ? workforceGroupTitle(position.workforceGroup) : "Unassigned"}
                {departmentTitle ? ` · ${departmentTitle}` : ""}
              </span>
            )}
          </div>
          {position.source === "workbook" && (
            <div className="flex items-center justify-between gap-3 border-b border-sdc-border-soft px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-sdc-muted">Expected Start Date</span>
              <HiringExpectedStartDateControl
                positionSourceId={position.sourceId}
                expectedStartDate={position.expectedStartDate}
                canAssign={canAssign}
                onSaved={(sourceId, date) => onUpdated(sourceId, { expectedStartDate: date })}
              />
            </div>
          )}
          {/* The pill, not plain text -- same colors as the row this drawer
              was opened from (HiringStatusPill / hiring-position-status.ts). */}
          <div className="flex items-center justify-between gap-3 border-b border-sdc-border-soft px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-sdc-muted">Job Status</span>
            <span className="flex items-center gap-2">
              <HiringStatusPill status={position.status} />
              {position.subStatus && position.subStatus !== "None" && <span className="text-note text-sdc-muted">{position.subStatus}</span>}
            </span>
          </div>
          {position.functionDescription && <Field label="Function" value={position.functionDescription} />}
          {position.sectionDescription && <Field label="Section" value={position.sectionDescription} />}
          {position.workLocDescription && <Field label="Work Location" value={position.workLocDescription} />}
          {position.createdDate && <Field label="Posted Date" value={position.createdDate} />}
          {position.createdBy && <Field label="Posted By" value={position.createdBy} />}
          {position.modifiedBy && <Field label="Last Updated By" value={position.modifiedBy} />}
          {position.remote && <Field label="Remote" value="Yes" />}
          {position.internal && <Field label="Internal Only" value="Yes" />}
          <Field label="Position ID" value={position.sourceId} />
          {position.source === "workbook" && !position.isManuallyAssigned && position.workforceGroup && (
            <p className="px-4 py-2.5 text-note text-sdc-muted">
              Placed here automatically from the position&apos;s title/function — not yet manually confirmed.
            </p>
          )}
        </div>
      )}
    </BuildReadinessDrawer>
  );
}
