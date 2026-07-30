"use client";

// The two bits of feedback every draft-applying toolbar menu needs (see
// useDraftParamMenu): a dot while changes are unapplied, a spinner while the
// navigation is in flight. Both occupy the chevron's slot so the button never
// changes width, and the chevron is hidden while spinning rather than crowded
// alongside it.
export function MenuStatus({ dirty, pending }: { dirty: boolean; pending: boolean }) {
  if (pending) {
    return (
      <svg viewBox="0 0 16 16" width="10" height="10" className="shrink-0 animate-spin" aria-label="Applying">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
        <path d="M8 2 a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <>
      {dirty && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      <svg
        viewBox="0 0 16 16"
        width="10"
        height="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="shrink-0 opacity-70 transition-transform duration-150 group-open:rotate-180"
      >
        <path d="M3.5 6 L8 10.5 L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  );
}

// Footer line for those menus — applying on close isn't discoverable on its own.
export function MenuApplyHint({ dirty }: { dirty: boolean }) {
  return (
    <p className="mt-1 border-t border-sdc-border-soft px-1.5 pt-1 text-[10px] text-sdc-gray-400">
      {dirty ? "Applies when you close this menu" : "Up to date"}
    </p>
  );
}
