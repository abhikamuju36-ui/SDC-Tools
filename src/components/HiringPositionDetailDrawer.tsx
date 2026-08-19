"use client";

import { useState, useTransition } from "react";
import { BuildReadinessDrawer } from "@/components/build-readiness/BuildReadinessDrawer";
import { HiringMoveToControl } from "@/components/HiringMoveToControl";
import { workforceGroupForCardKey, workforceGroupTitle, WORKFORCE_GROUPS, type WorkforceGroupKey } from "@/lib/employee-workforce-groups";
import { EMPLOYEE_TEAMS } from "@/lib/employee-teams";
import { updateHiringPosition } from "@/lib/hiring-actions";
import { MANUAL_JOB_STATUSES } from "@/lib/hiring-position-status";
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const departmentsInGroup = EMPLOYEE_TEAMS.filter((t) => workforceGroupForCardKey(t.schedulerCode) === workforceGroup);
  const selectedDepartment = departmentsInGroup.some((t) => t.schedulerCode === department) ? department : departmentsInGroup[0]?.schedulerCode ?? "";

  function save() {
    setError(null);
    if (!title.trim()) {
      setError("Position Title is required.");
      return;
    }
    startTransition(async () => {
      const result = await updateHiringPosition(position.sourceId, {
        title,
        jobStatus,
        workforceGroup,
        department: selectedDepartment,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onUpdated(position.sourceId, {
        title: title.trim(),
        status: jobStatus,
        isOpen: jobStatus === "Open",
        workforceGroup,
        department: selectedDepartment,
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
          {MANUAL_JOB_STATUSES.map((s) => (
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
          <Field label="Job Status" value={position.subStatus && position.subStatus !== "None" ? `${position.status} · ${position.subStatus}` : position.status} />
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
