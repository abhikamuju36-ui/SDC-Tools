"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { TOOLBAR_BTN, TOOLBAR_BTN_NEUTRAL } from "@/components/ui/classnames";
import { GridZoomBody } from "@/components/GridZoomControls";
import { readShowActuals, writeShowActuals, subscribeShowActuals } from "@/lib/quoted-display-prefs";

// "Display ▾" — how the grid looks rather than what's in it: the Actuals toggle
// and the two density steppers, replacing two more toolbar buttons.
//
// No draft/apply here, unlike Filters and Sections: every control in this menu
// is purely client-side (a body class and two CSS custom properties), so it takes
// effect instantly with no navigation. That's also why the menu deliberately
// stays open while you use it — you want to see each nudge land.
//
// Actuals lives here rather than in Filters because it changes what a cell
// *shows*, not which rows exist.
const ROW_VAR = "--quoted-row-py";
const COL_VAR = "--quoted-col-px";
const ROW_KEY = "quoted-grid-row-py";
const COL_KEY = "quoted-grid-col-px";

export function ProjectsDisplayMenu() {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // Read through useSyncExternalStore rather than useState + useEffect: no state
  // to sync, one fewer render per mount, no react-hooks/set-state-in-effect, and
  // it picks up a change made by the Show-all switch or another tab.
  const showActuals = useSyncExternalStore(
    subscribeShowActuals,
    readShowActuals,
    () => false, // server snapshot: hidden until the client says otherwise
  );

  // Mirror the value onto the body class the grid CSS keys off. An effect with
  // no setState in it, so it stays lint-clean; runs on mount and on every change,
  // including one made in another tab.
  useEffect(() => {
    document.body.classList.toggle("hide-actuals", !showActuals);
  }, [showActuals]);

  const toggleActuals = useCallback(() => writeShowActuals(!readShowActuals()), []);

  // Restore the saved density. This used to live in GridZoomControls, which the
  // Projects toolbar no longer renders — without moving it here, a chosen row
  // height would silently stop surviving a reload. Runs on mount whether or not
  // the menu is ever opened, which is why it's in this always-rendered component
  // rather than inside the popover.
  useEffect(() => {
    const clamp = (n: number) => Math.min(16, Math.max(0, n));
    const row = window.localStorage.getItem(ROW_KEY);
    const col = window.localStorage.getItem(COL_KEY);
    if (row != null) document.documentElement.style.setProperty(ROW_VAR, `${clamp(Number(row))}px`);
    if (col != null) document.documentElement.style.setProperty(COL_VAR, `${clamp(Number(col))}px`);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (detailsRef.current?.open && !detailsRef.current.contains(e.target as Node)) detailsRef.current.open = false;
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <details ref={detailsRef} className="group relative inline-block text-xs text-sdc-gray-500">
      <summary className={`${TOOLBAR_BTN} ${TOOLBAR_BTN_NEUTRAL}`}>
        Display
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
      </summary>
      <div className="absolute right-0 top-full z-30 mt-2 flex w-max min-w-[13rem] flex-col gap-2 rounded-lg border border-sdc-border bg-white p-2.5 shadow-lg">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span title="Show or hide actual hours next to quoted in each cell">Actual hours in cells</span>
          <input type="checkbox" checked={showActuals} onChange={toggleActuals} className="h-3.5 w-3.5 shrink-0" />
        </label>
        <div className="border-t border-sdc-border-soft pt-2">
          <GridZoomBody
            rowVar={ROW_VAR}
            colVar={COL_VAR}
            rowStorageKey={ROW_KEY}
            colStorageKey={COL_KEY}
            defaultRowPx={6}
            defaultColPx={4}
          />
        </div>
      </div>
    </details>
  );
}
