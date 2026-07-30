"use client";

import { TOOLBAR_BTN, TOOLBAR_BTN_ACTIVE, TOOLBAR_BTN_MUTED } from "@/components/ui/classnames";
import { useDraftParamMenu } from "@/components/useDraftParamMenu";
import { MenuStatus, MenuApplyHint } from "@/components/MenuStatus";

// Dropdown of checkboxes for one phase's section columns, driving the `cols`
// query param.
//
// Applies on close rather than per checkbox — see useDraftParamMenu. This one
// was the worst of the three for it: each tick adds or removes a whole column
// from a 50-row grid, so turning a phase's five sections off used to be five
// full re-renders, each one re-laying-out the table.
//
// Note `visibleCodes` spans EVERY phase, not just this one: the param is global,
// and this picker only ever adds or removes its own codes from it.
export function PhaseColumnPicker(props: {
  phase: string;
  sections: { code: string; name: string }[];
  visibleCodes: string[];
}) {
  return <PhaseMenu key={props.visibleCodes.join("")} {...props} />;
}

function PhaseMenu({
  phase,
  sections,
  visibleCodes,
}: {
  phase: string;
  sections: { code: string; name: string }[];
  visibleCodes: string[];
}) {
  const { draft, setDraft, dirty, pending, detailsRef, detailsProps, toggleValue } = useDraftParamMenu({
    committed: visibleCodes,
    // Always set, even when empty: on this grid an absent `cols` means "first
    // visit, use the default set", which differs from "the user hid everything".
    buildParams: (next, qs) => qs.set("cols", [...next].join(",")),
  });

  const phaseCodes = sections.map((s) => s.code);
  const checkedCount = phaseCodes.filter((c) => draft.has(c)).length;
  const allChecked = checkedCount === phaseCodes.length;
  const noneChecked = checkedCount === 0;

  // Select all / Clear act on THIS phase's codes only, leaving other phases'
  // selections in the draft untouched.
  function setAll(checked: boolean) {
    setDraft((prev) => {
      const next = new Set(prev);
      for (const code of phaseCodes) {
        if (checked) next.add(code);
        else next.delete(code);
      }
      return next;
    });
  }

  return (
    <details ref={detailsRef} {...detailsProps} className="group relative inline-block">
      <summary
        className={`${TOOLBAR_BTN} ${noneChecked ? TOOLBAR_BTN_MUTED : TOOLBAR_BTN_ACTIVE} ${pending ? "opacity-60" : ""}`}
      >
        {phase}
        {!allChecked && ` (${checkedCount}/${phaseCodes.length})`}
        <MenuStatus dirty={dirty} pending={pending} />
      </summary>
      <div className="absolute left-0 top-full z-30 mt-2 w-56 rounded-lg border border-sdc-border bg-white p-2 shadow-lg">
        <div className="mb-1 flex items-center justify-between px-1.5 pb-1 text-[11px] text-sdc-gray-400">
          <button type="button" onClick={() => setAll(true)} className="underline hover:text-sdc-navy">
            Select all
          </button>
          <button type="button" onClick={() => setAll(false)} className="underline hover:text-sdc-navy">
            Clear
          </button>
        </div>
        {sections.map((s) => (
          <label
            key={s.code}
            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-sdc-gray-100"
          >
            <input
              type="checkbox"
              checked={draft.has(s.code)}
              onChange={() => toggleValue(s.code)}
              className="h-3.5 w-3.5 shrink-0"
            />
            <span className="flex-1 truncate">{s.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-sdc-gray-400">{s.code}</span>
          </label>
        ))}
        <MenuApplyHint dirty={dirty} />
      </div>
    </details>
  );
}
