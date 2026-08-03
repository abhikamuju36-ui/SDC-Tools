"use client";

import { TOOLBAR_BTN, TOOLBAR_BTN_ACTIVE, TOOLBAR_BTN_NEUTRAL } from "@/components/ui/classnames";
import { useDraftParamsMenu } from "@/components/useDraftParamMenu";
import { encodeParamList } from "@/lib/quoted-display-prefs";
import { MenuStatus, MenuApplyHint, MenuGroup, MenuBulkActions, MenuCheckbox } from "@/components/MenuStatus";
import { RESTRICTED_SECTION_CODES } from "@/lib/sections";
import { useProjectsEditMode } from "@/components/ProjectsEditMode";
import { useRouter } from "next/navigation";
import { useRef } from "react";

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

// The remount-on-change wrapper this used to have is gone — the hook resyncs
// its own draft, and with every tick applying immediately a remount would close
// the menu on the first click. See useDraftParamMenu.
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

  // ── Fetch the restricted sections only when they're actually wanted ────────
  //
  // The Edit Mode toggle no longer refreshes the route unless a restricted
  // column is already on screen (see ProjectsEditMode) — that refresh re-rendered
  // 233 rows to usually change nothing, and was what "updating columns…" waited
  // on. The one thing that DID depend on it is this list: the server omits PM,
  // Manufacturing and the two Warranty sections while locked, so without a
  // refresh they'd never appear here and could never be switched on.
  //
  // So the cost moves to the moment it's needed: if this menu is opened while
  // editing and the server hasn't sent them, ask for them then. Opening a menu is
  // a deliberate act and a wait there is expected; toggling a switch is not.
  const { editing } = useProjectsEditMode();
  const router = useRouter();
  const askedRef = useRef(false);
  const hasRestricted = phases.some((p) => p.sections.some((sec) => RESTRICTED_SECTION_CODES.has(sec.code)));
  // On OPEN, not on the mode change — asking as soon as Edit Mode flipped would
  // just move the same refresh back onto the toggle, which is the thing being
  // fixed. Once per mount is enough; if it fails there is nothing to retry into.
  function onOpenMaybeFetch(open: boolean) {
    if (!open || !editing || hasRestricted || askedRef.current) return;
    askedRef.current = true;
    router.refresh();
  }

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
    <details
      ref={detailsRef}
      {...detailsProps}
      onToggle={(e) => {
        // The hook's handler owns apply-on-close; this only adds the
        // fetch-on-open above. Both must run, and its ignore-descendants guard
        // still applies because it sees the same event.
        detailsProps.onToggle(e);
        if (e.target === e.currentTarget) onOpenMaybeFetch(e.currentTarget.open);
      }}
      className="group relative inline-block"
    >
      <summary
        className={`${TOOLBAR_BTN} ${allShown ? TOOLBAR_BTN_NEUTRAL : TOOLBAR_BTN_ACTIVE} ${pending ? "opacity-60" : ""}`}
      >
        Sections
        {` (${shownCount}/${allSections.length})`}
        <MenuStatus pending={pending} />
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
              // Every phase open — MenuGroup's default. Fully-on phases used to
              // stay collapsed, so the common case (nothing hidden yet) opened
              // to a menu of closed rows.
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
