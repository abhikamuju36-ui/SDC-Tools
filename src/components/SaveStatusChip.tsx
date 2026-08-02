"use client";

import { autosaveLabel, type AutosaveStatus } from "@/lib/autosave";

// The autosave read-out for both grids. It replaces nothing — the manual Save
// button stays — but with edits committing on their own, "did that save?"
// becomes the question the toolbar has to answer at a glance, and an unlabelled
// spinner is not an answer.
//
// Ported in spirit from the Scheduler's save-status chip (2026-07-23), which
// was built after a manager lost 1,148 meeting notes to an autosave everyone
// assumed was working. The lesson there was that the failure state needs to be
// loud and needs a way out, hence the Retry.
export function SaveStatusChip({ status, onRetry }: { status: AutosaveStatus; onRetry?: () => void }) {
  if (status === "idle") return null;
  const label = autosaveLabel(status);

  if (status === "error") {
    return (
      <span className="flex items-center gap-1.5 rounded-md border border-sdc-red-border bg-sdc-red-bg px-2 py-1 text-[11px] font-medium text-sdc-red-text">
        <WarnIcon />
        {label}
        {onRetry && (
          <button type="button" onClick={onRetry} className="ml-0.5 underline underline-offset-2 hover:no-underline">
            Retry
          </button>
        )}
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-live="polite"
      className={`flex items-center gap-1.5 text-[11px] font-medium ${
        status === "saved" ? "text-sdc-green-text" : "text-sdc-gray-600"
      }`}
    >
      {status === "saving" && <Spinner />}
      {status === "saved" && <CheckIcon />}
      {status === "pending" && <DotIcon />}
      {label}
    </span>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" className="animate-spin" aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M8 2 a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 8.5 L6.5 12 L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function DotIcon() {
  return (
    <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden>
      <circle cx="8" cy="8" r="4" fill="currentColor" opacity="0.55" />
    </svg>
  );
}
function WarnIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M8 3.5 L14 13 H2 Z" strokeLinejoin="round" />
      <path d="M8 7v2.5" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
