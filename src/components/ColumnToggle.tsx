"use client";

import { TOOLBAR_BTN, TOOLBAR_BTN_ACTIVE, TOOLBAR_BTN_NEUTRAL } from "@/components/ui/classnames";
import { useDraftParamMenu } from "@/components/useDraftParamMenu";
import { MenuStatus, MenuApplyHint } from "@/components/MenuStatus";

export type ToggleColumn = { key: string; label: string };

// Generic show/hide dropdown for info columns on a grid. Drives a single
// `hide` query param (comma-separated column keys); absent = all shown, so
// default URLs stay clean and it's bookmark/share-able like the other
// filters. Same dropdown interaction as DeptColumnFilter/PhaseColumnPicker.
//
// Applies on close rather than per checkbox — see useDraftParamMenu. Hiding
// three columns used to mean three full grid re-renders.
export function ColumnToggle({ columns, hidden }: { columns: ToggleColumn[]; hidden: string[] }) {
  return <ColumnMenu key={hidden.join("")} columns={columns} hidden={hidden} />;
}

function ColumnMenu({ columns, hidden }: { columns: ToggleColumn[]; hidden: string[] }) {
  const { draft, dirty, pending, detailsRef, detailsProps, toggleValue } = useDraftParamMenu({
    // The draft tracks HIDDEN keys, matching the param, even though the
    // checkboxes read as "shown" — inverted once at the input rather than twice
    // more on the way to the URL.
    committed: hidden,
    buildParams: (next, qs) => {
      if (next.size === 0) qs.delete("hide"); // all shown -> clean URL
      // Ordered by the column list, not by click order, so the same visible set
      // always produces the same URL (shareable, and no spurious history).
      else qs.set("hide", columns.filter((c) => next.has(c.key)).map((c) => c.key).join(","));
    },
  });

  const allShown = draft.size === 0;

  return (
    <details ref={detailsRef} {...detailsProps} className="group relative inline-block">
      <summary
        className={`${TOOLBAR_BTN} ${allShown ? TOOLBAR_BTN_NEUTRAL : TOOLBAR_BTN_ACTIVE} ${pending ? "opacity-60" : ""}`}
      >
        Columns
        {!allShown && ` (${columns.length - draft.size}/${columns.length})`}
        <MenuStatus dirty={dirty} pending={pending} />
      </summary>
      <div className="absolute left-0 top-full z-30 mt-2 w-52 rounded-lg border border-sdc-border bg-white p-2 shadow-lg">
        <p className="px-1.5 pb-1 text-[11px] text-sdc-gray-400">Show columns:</p>
        {columns.map((c) => (
          <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-sdc-gray-100">
            <input
              type="checkbox"
              checked={!draft.has(c.key)}
              onChange={() => toggleValue(c.key)}
              className="h-3.5 w-3.5 shrink-0"
            />
            <span className="flex-1">{c.label}</span>
          </label>
        ))}
        <MenuApplyHint dirty={dirty} />
      </div>
    </details>
  );
}
