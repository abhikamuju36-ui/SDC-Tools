"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

// Shared behaviour for the Projects toolbar's bucketed dropdowns (Filters,
// Sections, Display).
//
// ── Why drafts (2026-07-30) ──────────────────────────────────────────────────
// These menus used to navigate on EVERY checkbox, with `checked` read straight
// from a server prop. So a tick couldn't appear until the server had re-rendered
// the whole 50-job x 13-column grid and shipped it back, and picking four values
// meant four sequential full-page reloads. The page's queries are fast (~60ms for
// all of them, measured 2026-07-30) — it's the grid render and transfer that
// costs, so the fix is to pay it once per menu visit instead of once per click.
//
// Now: ticks land in local state immediately, and the URL is written when the
// menu CLOSES, via <details>' own toggle event — so outside click, re-clicking
// the summary and Esc all commit, rather than only one of them.
//
// Handles SEVERAL params per menu, because the buckets each cover more than one:
// Filters owns customers/types/statuses/billables, Sections owns cols/hide.
//
// IMPORTANT: the caller must remount on a change of `committed` (render the menu
// body under a key derived from it), which is what resets the draft to the
// confirmed value. Deliberately not an effect — syncing state to props in an
// effect is both a lint error here (react-hooks/set-state-in-effect) and a
// source of one-render-stale flicker.
export function useDraftParamsMenu<K extends string>({
  committed,
  buildParams,
}: {
  // param key -> the server's current answer for it
  committed: Record<K, string[]>;
  // Write the draft into the query string. Mutating `qs` is expected — delete a
  // param to keep default URLs clean, or set it, whichever suits the menu.
  buildParams: (draft: Record<K, string[]>, qs: URLSearchParams) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<K, string[]>>(() => ({ ...committed }));

  const norm = (v: Record<K, string[]>) =>
    (Object.keys(v) as K[])
      .sort()
      .map((k) => `${k}=${[...v[k]].sort().join(",")}`)
      .join("&");
  const dirty = norm(committed) !== norm(draft);

  // Replace one param's values in the draft.
  function setValues(key: K, values: string[]) {
    setDraft((prev) => ({ ...prev, [key]: values }));
  }

  // Add/remove a single value from one param.
  function toggleValue(key: K, value: string) {
    setDraft((prev) => {
      const cur = prev[key] ?? [];
      return { ...prev, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  }

  function apply() {
    if (!dirty) return; // opened, looked, closed — no need to reload the grid
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
    setValues,
    toggleValue,
    dirty,
    pending,
    detailsRef,
    // Spread onto the OUTER <details>.
    detailsProps: {
      onToggle: (e: React.SyntheticEvent<HTMLDetailsElement>) => {
        // These menus contain nested <details> for their groups. `toggle` doesn't
        // bubble per spec, but React's synthetic system can still deliver a
        // descendant's event here — so ignore anything that isn't this element
        // opening/closing, or expanding a group would commit the draft early.
        if (e.target !== e.currentTarget) return;
        if (!e.currentTarget.open) apply();
      },
    },
  };
}
