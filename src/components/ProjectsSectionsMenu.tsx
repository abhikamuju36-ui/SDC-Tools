"use client";

import { TOOLBAR_BTN, TOOLBAR_BTN_ACTIVE, TOOLBAR_BTN_NEUTRAL } from "@/components/ui/classnames";
import { useDraftParamsMenu } from "@/components/useDraftParamMenu";
import { encodeParamList } from "@/lib/quoted-display-prefs";
import { MenuStatus, MenuApplyHint, MenuGroup, MenuBulkActions, MenuCheckbox } from "@/components/MenuStatus";

// "Sections ▾" — which columns the grid shows: the four phase pickers plus the
// info columns (Job/Customer/Type/…), replacing five toolbar buttons.
//
// Two params in one menu, which is why the hook is multi-param: `cols` (section
// codes to show) and `hide` (info columns to hide). They're grouped together
// because from the user's side both answer one question — what's in the grid.
//
// The button reads "Sections (9/11)" so the headline number the old phase
// buttons carried survives the bucketing.

export type PhaseSpec = { phase: string; sections: { code: string; name: string }[] };
export type InfoColumn = { key: string; label: string };
type Key = "cols" | "hide";

export function ProjectsSectionsMenu({
  phases,
  visibleCodes,
  infoColumns,
  hiddenInfo,
}: {
  phases: PhaseSpec[];
  visibleCodes: string[];
  infoColumns: InfoColumn[];
  hiddenInfo: string[];
}) {
  return (
    <SectionsMenuBody
      key={`${visibleCodes.join("")}|${hiddenInfo.join("")}`}
      phases={phases}
      visibleCodes={visibleCodes}
      infoColumns={infoColumns}
      hiddenInfo={hiddenInfo}
    />
  );
}

function SectionsMenuBody({
  phases,
  visibleCodes,
  infoColumns,
  hiddenInfo,
}: {
  phases: PhaseSpec[];
  visibleCodes: string[];
  infoColumns: InfoColumn[];
  hiddenInfo: string[];
}) {
  const { draft, setValues, toggleValue, dirty, pending, detailsRef, detailsProps } = useDraftParamsMenu<Key>({
    committed: { cols: visibleCodes, hide: hiddenInfo },
    buildParams: (d, qs) => {
      // `cols` is always set, even empty: absent means "first visit, use the
      // default section set", not "the user hid everything".
      qs.set("cols", encodeParamList(d.cols ?? []));
      // `hide` is deleted when empty so a default URL stays clean and shareable.
      const hide = d.hide ?? [];
      if (hide.length === 0) qs.delete("hide");
      // Ordered by the column list rather than click order, so the same visible
      // set always produces the same URL.
      else qs.set("hide", encodeParamList(infoColumns.filter((c) => hide.includes(c.key)).map((c) => c.key)));
    },
  });

  const cols = draft.cols ?? [];
  const hidden = draft.hide ?? [];
  const allSections = phases.flatMap((p) => p.sections);
  const shownCount = allSections.filter((s) => cols.includes(s.code)).length;
  const allShown = shownCount === allSections.length && hidden.length === 0;

  // Add/remove a whole phase's codes without touching the other phases'.
  function setPhase(spec: PhaseSpec, checked: boolean) {
    const phaseCodes = spec.sections.map((s) => s.code);
    const rest = cols.filter((c) => !phaseCodes.includes(c));
    setValues("cols", checked ? [...rest, ...phaseCodes] : rest);
  }

  return (
    <details ref={detailsRef} {...detailsProps} className="group relative inline-block">
      <summary
        className={`${TOOLBAR_BTN} ${allShown ? TOOLBAR_BTN_NEUTRAL : TOOLBAR_BTN_ACTIVE} ${pending ? "opacity-60" : ""}`}
      >
        Sections
        {` (${shownCount}/${allSections.length})`}
        <MenuStatus dirty={dirty} pending={pending} />
      </summary>
      <div className="styled-scrollbar absolute left-0 top-full z-30 mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-sdc-border bg-white p-2 shadow-lg">
        {phases.map((p) => {
          const phaseCodes = p.sections.map((s) => s.code);
          const on = phaseCodes.filter((c) => cols.includes(c)).length;
          return (
            <MenuGroup
              key={p.phase}
              label={p.phase}
              count={`${on}/${phaseCodes.length}`}
              // Fully-on phases stay collapsed; anything partially hidden opens,
              // since that's the state someone came here to see or undo.
              defaultOpen={on > 0 && on < phaseCodes.length}
            >
              <MenuBulkActions onAll={() => setPhase(p, true)} onNone={() => setPhase(p, false)} />
              {p.sections.map((s) => (
                <MenuCheckbox
                  key={s.code}
                  label={s.name}
                  suffix={s.code}
                  checked={cols.includes(s.code)}
                  onChange={() => toggleValue("cols", s.code)}
                />
              ))}
            </MenuGroup>
          );
        })}
        {/* Info columns last: they're the job metadata, not the hours matrix, and
            they're changed far less often than the phase columns. */}
        <MenuGroup
          label="Info columns"
          count={`${infoColumns.length - hidden.length}/${infoColumns.length}`}
          defaultOpen={hidden.length > 0}
        >
          <MenuBulkActions onAll={() => setValues("hide", [])} onNone={() => setValues("hide", infoColumns.map((c) => c.key))} />
          {infoColumns.map((c) => (
            <MenuCheckbox
              key={c.key}
              label={c.label}
              // The draft tracks HIDDEN keys to match the param; inverted once
              // here rather than twice on the way to the URL.
              checked={!hidden.includes(c.key)}
              onChange={() => toggleValue("hide", c.key)}
            />
          ))}
        </MenuGroup>
        <MenuApplyHint dirty={dirty} />
      </div>
    </details>
  );
}
