"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Shared behaviour for the Projects toolbar's checkbox dropdowns
// (MultiSelectFilter, ColumnToggle, PhaseColumnPicker).
//
// All three used to navigate on EVERY checkbox, with `checked` read from a server
// prop — so a tick couldn't appear until the whole 50-job x 13-column grid had
// been re-rendered and shipped back, and picking four values meant four
// sequential full-page reloads. The page's queries are fast (~60ms for all of
// them, measured 2026-07-30); it's the grid render and transfer that costs, so
// the fix is to pay it once per menu visit instead of once per click.
//
// This hook holds the draft selection, reports whether it differs from what the
// server has, and writes the URL when the menu CLOSES — covering outside click,
// clicking the summary again, and Esc, via <details>' own toggle event.
//
// IMPORTANT: the caller must remount on a change of `committed` (render this
// under `key={committed.join("")}`), which is what resets the draft to the
// confirmed value. Deliberately not an effect — syncing state to props in an
// effect is both a lint error here (react-hooks/set-state-in-effect) and a
// source of one-render-stale flicker.
export function useDraftParamMenu({
  committed,
  buildParams,
}: {
  // The server's current answer for this menu.
  committed: string[];
  // Write the draft into the query string. Mutating `qs` is expected — delete a
  // param to keep default URLs clean, or set it, whichever suits the menu.
  buildParams: (next: Set<string>, qs: URLSearchParams) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Set<string>>(() => new Set(committed));

  // Sorted comparison so ordering noise can't trigger a pointless reload.
  const dirty = [...committed].sort().join(",") !== [...draft].sort().join(",");

  function apply() {
    if (!dirty) return; // opened, looked, closed
    const qs = new URLSearchParams(searchParams.toString());
    buildParams(draft, qs);
    const q = qs.toString();
    startTransition(() => {
      router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
    });
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const el = detailsRef.current;
      // Setting `open` fires onToggle, which is where apply() runs — one path
      // for every way of closing rather than one per trigger.
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    }
    document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
  }, []);

  return {
    draft,
    setDraft,
    dirty,
    pending,
    detailsRef,
    // Spread onto the <details>.
    detailsProps: {
      onToggle: (e: React.SyntheticEvent<HTMLDetailsElement>) => {
        if (!e.currentTarget.open) apply();
      },
    },
    toggleValue: (value: string) =>
      setDraft((prev) => {
        const next = new Set(prev);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      }),
  };
}
