"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { nextParams, notePendingParams } from "@/lib/url-params";
import { TOOLBAR_BTN, TOOLBAR_BTN_NEUTRAL } from "@/components/ui/classnames";
import { GridZoomBody } from "@/components/GridZoomControls";
import { ACTUALS_PARAM, isActualsOn } from "@/lib/quoted-display-prefs";

// "Display ▾" — how the grid looks rather than what's in it: the Actuals toggle
// and the two density steppers, replacing two more toolbar buttons.
//
// No draft/apply here, unlike Filters and Sections: each control takes effect on
// the click, so the menu deliberately stays open while you use it — you want to
// see each nudge land. The two density steppers are pure CSS custom properties;
// Actuals is a view param and re-renders the grid (see quoted-display-prefs.ts).
//
// Actuals lives here rather than in Filters because it changes what a cell
// *shows*, not which rows exist.
const ROW_VAR = "--quoted-row-py";
const COL_VAR = "--quoted-col-px";
const ROW_KEY = "quoted-grid-row-py";
const COL_KEY = "quoted-grid-col-px";

export function ProjectsDisplayMenu() {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Actuals is a view param now, not a localStorage flag mirrored onto a body
  // class by an effect here — see quoted-display-prefs.ts for why. The checkbox
  // therefore reads straight off the URL and stays in step with the Show-all
  // switch by construction: there's only one value, and both controls write it.
  const showActuals = isActualsOn(searchParams);

  // replace, not push: this is a display preference, and stacking a history
  // entry per click would make Back walk the checkbox instead of leaving the
  // page. The Show-all switch pushes, deliberately — that one changes the data.
  const toggleActuals = useCallback(() => {
    // See lib/url-params.ts — this replace goes through a transition too, so
    // useSearchParams stays on the old value until it commits, and a filter
    // changed just before this would be dropped from the URL.
    const currentQs = searchParams.toString();
    const qs = nextParams(currentQs);
    if (showActuals) qs.delete(ACTUALS_PARAM);
    else qs.set(ACTUALS_PARAM, "1");
    const q = qs.toString();
    notePendingParams(currentQs, q);
    startTransition(() => {
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    });
  }, [showActuals, searchParams, pathname, router]);

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
