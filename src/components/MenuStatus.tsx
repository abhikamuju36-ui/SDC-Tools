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

// A collapsible group inside a bucketed menu (Filters/Sections). `count` is the
// "3/11"-style summary that lets you read the state without opening the group,
// which is what keeps two-clicks-deep from feeling blind.
//
// `defaultOpen` should be set when the group is actively narrowing something —
// an active filter you'd have to hunt for is worse than a slightly taller menu.
export function MenuGroup({
  label,
  count,
  defaultOpen = false,
  children,
}: {
  label: string;
  count?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group/g border-b border-sdc-border-soft last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-1.5 py-1.5 text-[11px] font-semibold text-sdc-navy hover:bg-sdc-gray-100">
        <svg
          viewBox="0 0 16 16"
          width="8"
          height="8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          className="shrink-0 opacity-60 transition-transform duration-150 group-open/g:rotate-90"
        >
          <path d="M6 3.5 L10.5 8 L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="flex-1 truncate">{label}</span>
        {count && <span className="shrink-0 font-normal tabular-nums text-sdc-gray-400">{count}</span>}
      </summary>
      <div className="pb-1 pl-2.5">{children}</div>
    </details>
  );
}

// Select all / Clear pair, repeated in every group.
export function MenuBulkActions({ onAll, onNone }: { onAll: () => void; onNone: () => void }) {
  return (
    <div className="flex items-center gap-3 px-1.5 pb-1 text-[10px] text-sdc-gray-400">
      <button type="button" onClick={onAll} className="underline hover:text-sdc-navy">
        Select all
      </button>
      <button type="button" onClick={onNone} className="underline hover:text-sdc-navy">
        Clear
      </button>
    </div>
  );
}

// One checkbox row. `suffix` carries the section code on the Sections menu.
export function MenuCheckbox({
  label,
  checked,
  onChange,
  suffix,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  suffix?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-sdc-gray-100">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {suffix && <span className="shrink-0 font-mono text-[10px] text-sdc-gray-400">{suffix}</span>}
    </label>
  );
}
