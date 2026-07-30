"use client";

import { useState } from "react";
import { TOOLBAR_BTN, TOOLBAR_BTN_ACTIVE, TOOLBAR_BTN_NEUTRAL, INPUT } from "@/components/ui/classnames";
import { useDraftParamsMenu } from "@/components/useDraftParamMenu";
import { MenuStatus, MenuApplyHint, MenuGroup, MenuBulkActions, MenuCheckbox } from "@/components/MenuStatus";

// "Filters ▾" — the Projects grid's four row filters (Customer, Type, Status,
// Billable) in one bucket, replacing four separate toolbar buttons.
//
// The toolbar had twelve controls; four of them were filters that all did the
// same kind of thing to the same rows, so they belong behind one label. The
// button's badge counts how many are NARROWING (fewer selected than available),
// which is the only filter state worth surfacing at a glance — "all four
// filters exist" isn't information.
//
// Applies on close, one navigation for the whole visit — see useDraftParamsMenu.

export type FilterKey = "customers" | "types" | "statuses" | "billables";

export type FilterSpec = {
  key: FilterKey;
  label: string;
  options: string[];
  selected: string[];
  // Long lists get a search box; four-option lists don't need one.
  searchable?: boolean;
};

export function ProjectsFilterMenu({ filters }: { filters: FilterSpec[] }) {
  // Remount on any change to the committed values, which resets the draft.
  const key = filters.map((f) => `${f.key}:${f.selected.join("")}`).join("|");
  return <FilterMenuBody key={key} filters={filters} />;
}

function FilterMenuBody({ filters }: { filters: FilterSpec[] }) {
  const committed = Object.fromEntries(filters.map((f) => [f.key, f.selected])) as Record<FilterKey, string[]>;
  const { draft, setValues, toggleValue, dirty, pending, detailsRef, detailsProps } = useDraftParamsMenu<FilterKey>({
    committed,
    // Always set, even when empty: on this grid an absent param means "no filter
    // chosen yet, use the page default" (Active + Billable), which is NOT the
    // same as the user having cleared it.
    buildParams: (d, qs) => {
      for (const f of filters) qs.set(f.key, (d[f.key] ?? []).join(","));
    },
  });

  // Search text per filter, local to the open menu — not part of the draft.
  const [query, setQuery] = useState<Partial<Record<FilterKey, string>>>({});

  const narrowing = filters.filter((f) => (draft[f.key] ?? []).length < f.options.length).length;

  return (
    <details ref={detailsRef} {...detailsProps} className="group relative inline-block">
      <summary
        className={`${TOOLBAR_BTN} ${narrowing > 0 ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN_NEUTRAL} ${pending ? "opacity-60" : ""}`}
      >
        Filters
        {narrowing > 0 && ` (${narrowing})`}
        <MenuStatus dirty={dirty} pending={pending} />
      </summary>
      <div className="styled-scrollbar absolute left-0 top-full z-30 mt-2 max-h-[70vh] w-64 overflow-y-auto rounded-lg border border-sdc-border bg-white p-2 shadow-lg">
        {filters.map((f) => {
          const sel = draft[f.key] ?? [];
          const q = (query[f.key] ?? "").trim().toLowerCase();
          const shown = q ? f.options.filter((o) => o.toLowerCase().includes(q)) : f.options;
          return (
            <MenuGroup
              key={f.key}
              label={f.label}
              count={`${sel.length}/${f.options.length}`}
              // Open the ones that are actually filtering, so an active filter is
              // never hidden behind a collapsed group.
              defaultOpen={sel.length < f.options.length}
            >
              {f.searchable && f.options.length > 8 && (
                <input
                  type="search"
                  value={query[f.key] ?? ""}
                  onChange={(e) => setQuery((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={`Search ${f.label.toLowerCase()}…`}
                  className={`${INPUT} mb-1 w-full text-xs`}
                />
              )}
              <MenuBulkActions
                // Select all / Clear act on the FULL option list, not the
                // search-filtered view — "Clear" that only cleared what you'd
                // typed would be a trap.
                onAll={() => setValues(f.key, [...f.options])}
                onNone={() => setValues(f.key, [])}
              />
              <div className="max-h-56 overflow-y-auto styled-scrollbar">
                {shown.map((opt) => (
                  <MenuCheckbox
                    key={opt}
                    label={opt}
                    checked={sel.includes(opt)}
                    onChange={() => toggleValue(f.key, opt)}
                  />
                ))}
                {shown.length === 0 && <p className="px-1.5 py-1 text-xs text-sdc-gray-400">No matches</p>}
              </div>
            </MenuGroup>
          );
        })}
        <MenuApplyHint dirty={dirty} />
      </div>
    </details>
  );
}
