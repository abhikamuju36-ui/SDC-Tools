"use client";

import { TOOLBAR_BTN, TOOLBAR_BTN_ACTIVE, TOOLBAR_BTN_MUTED } from "@/components/ui/classnames";
import { useDraftParamMenu } from "@/components/useDraftParamMenu";
import { MenuStatus, MenuApplyHint } from "@/components/MenuStatus";

// Generic multi-select dropdown filter (Customer / Type / Status / Billable on
// the Projects grid). Drives row filtering via a query param.
//
// Ticks land locally and the URL is written when the menu closes — see
// useDraftParamMenu for why. The outer component exists purely to supply the
// remount key that resets the draft once the server has answered.
export function MultiSelectFilter(props: {
  label: string;
  paramName: string;
  options: string[];
  selected: string[];
}) {
  return <FilterMenu key={props.selected.join("")} {...props} />;
}

function FilterMenu({
  label,
  paramName,
  options,
  selected,
}: {
  label: string;
  paramName: string;
  options: string[];
  selected: string[];
}) {
  const { draft, setDraft, dirty, pending, detailsRef, detailsProps, toggleValue } = useDraftParamMenu({
    committed: selected,
    // Always set, even when empty: an absent param means "no filter yet, use the
    // page's default" on this grid, which is NOT the same as "user cleared it".
    buildParams: (next, qs) => qs.set(paramName, [...next].join(",")),
  });

  const checkedCount = options.filter((o) => draft.has(o)).length;
  const allChecked = checkedCount === options.length;
  const noneChecked = checkedCount === 0;

  return (
    <details ref={detailsRef} {...detailsProps} className="group relative inline-block">
      <summary
        className={`${TOOLBAR_BTN} ${noneChecked ? TOOLBAR_BTN_MUTED : TOOLBAR_BTN_ACTIVE} ${pending ? "opacity-60" : ""}`}
      >
        {label}
        {!allChecked && ` (${checkedCount}/${options.length})`}
        <MenuStatus dirty={dirty} pending={pending} />
      </summary>
      <div className="styled-scrollbar absolute left-0 top-full z-30 mt-2 max-h-72 w-56 overflow-y-auto rounded-lg border border-sdc-border bg-white p-2 shadow-lg">
        <div className="mb-1 flex items-center justify-between px-1.5 pb-1 text-[11px] text-sdc-gray-400">
          <button type="button" onClick={() => setDraft(new Set(options))} className="underline hover:text-sdc-navy">
            Select all
          </button>
          <button type="button" onClick={() => setDraft(new Set())} className="underline hover:text-sdc-navy">
            Clear
          </button>
        </div>
        {options.map((opt) => (
          <label key={opt} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-sdc-gray-100">
            <input
              type="checkbox"
              checked={draft.has(opt)}
              onChange={() => toggleValue(opt)}
              className="h-3.5 w-3.5 shrink-0"
            />
            <span className="flex-1 truncate">{opt}</span>
          </label>
        ))}
        {options.length === 0 && <p className="px-1.5 py-1 text-xs text-sdc-gray-400">No options</p>}
        <MenuApplyHint dirty={dirty} />
      </div>
    </details>
  );
}
