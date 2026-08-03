"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { nextParams, notePendingParams } from "@/lib/url-params";
import { useTransition } from "react";

// Shared behaviour for the Projects toolbar's bucketed dropdowns (Filters,
// Sections, Dates).
//
// ── Why local state at all (2026-07-30) ─────────────────────────────────────
// These menus used to navigate on EVERY checkbox, with `checked` read straight
// from a server prop. So a tick couldn't APPEAR until the server had re-rendered
// the whole 224-job x 20-column grid and shipped it back — the checkbox itself
// lagged the click by a visible beat, which is what made them feel broken.
//
// Keeping a local draft fixes that: the tick lands in state immediately and the
// checkbox is never waiting on the network.
//
// ── Why it no longer waits for the menu to close (2026-08-03, by request) ────
// The first version of this hook took the fix too far and only wrote the URL
// when the menu CLOSED. That made the checkbox instant but the RESULT deferred:
// untick a customer and the grid sat there unchanged until you closed the menu,
// with a "Applies when you close this menu" line as the only explanation. Users
// reasonably read that as the filter not working.
//
// Now: the tick is instant AND the grid follows on its own, ~250ms later. The
// delay is a debounce, not a wait for anything — it exists so that ticking five
// customers in a row costs ONE navigation instead of five, which is the whole
// reason the apply-on-close version existed. Closing the menu flushes anything
// still on the timer, so a change can never be lost by closing fast.
//
// Handles SEVERAL params per menu, because the buckets each cover more than one:
// Filters owns customers/types/statuses/billables, Sections owns cols/hide.
//
// The caller must NOT remount on a change of `committed` — this hook resyncs the
// draft itself (see below). Remounting was the old contract, and applying on
// every tick makes it actively wrong: a remount rebuilds the <details> element,
// which slams the menu shut on the first click, and throws away the search box's
// text along with it.
const DEFAULT_DEBOUNCE_MS = 250;

export function useDraftParamsMenu<K extends string>({
  committed,
  buildParams,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: {
  // param key -> the server's current answer for it
  committed: Record<K, string[]>;
  // Write the draft into the query string. Mutating `qs` is expected — delete a
  // param to keep default URLs clean, or set it, whichever suits the menu.
  buildParams: (draft: Record<K, string[]>, qs: URLSearchParams) => void;
  debounceMs?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<K, string[]>>(() => ({ ...committed }));

  // Comparison key only, never a URL. JSON-encoded rather than comma-joined so a
  // value that itself contains a comma (customer names do) can't make two
  // different selections compare equal and leave `dirty` false — a menu visit
  // that then silently discarded the user's change.
  const norm = (v: Record<K, string[]>) =>
    JSON.stringify(
      (Object.keys(v) as K[]).sort().map((k) => [k, [...v[k]].sort()]),
    );
  const committedKey = norm(committed);
  const draftKey = norm(draft);
  const dirty = committedKey !== draftKey;

  // Adopt a new server answer. Replaces the old "remount under a key" contract,
  // for the reasons in the header note. Set-state-during-render is the supported
  // way to derive state from props — deliberately not an effect, which would
  // render one frame stale and trips react-hooks/set-state-in-effect.
  //
  // In the normal case this fires just after our OWN push commits, and sets the
  // draft to what it already was. It earns its keep for changes that come from
  // somewhere else: the "Show all" switch, loading a saved View, or the Back
  // button — all of which used to be picked up by the remount.
  const [seenCommitted, setSeenCommitted] = useState(committedKey);
  if (seenCommitted !== committedKey) {
    setSeenCommitted(committedKey);
    setDraft({ ...committed });
  }

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

  // The push itself. Reads `draft` from the closure of whichever render
  // scheduled it, which is exactly right: the debounce is restarted on every
  // change, so the call that survives is always the newest one.
  function apply() {
    if (!dirty) return; // opened, looked, closed — no need to reload the grid
    // nextParams, not searchParams directly: inside a transition that hook
    // still reports the PRE-navigation query string, so a second change landing
    // while the first is still rendering would rebuild the URL without the
    // first one and silently revert it. That window is the normal case now that
    // every tick navigates. See lib/url-params.ts.
    const current = searchParams.toString();
    const qs = nextParams(current);
    buildParams(draft, qs);
    const q = qs.toString();
    notePendingParams(current, q); // before the push, so the next tick sees it
    startTransition(() => {
      router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
    });
  }

  // Debounced auto-apply. The cleanup is what makes it a debounce: a change
  // arriving before the timer fires cancels the previous one, so a burst of
  // ticks collapses into a single navigation once the user pauses.
  //
  // Keyed on draftKey rather than the draft object so a resync that produces an
  // equal value doesn't restart the clock. `dirty` is false on mount and false
  // again once a push commits, which is what keeps this from firing on either.
  // apply() closes over this render's draft and query string, and it is a new
  // function every render, so it can't go in the debounce's dependency list
  // without restarting the timer on every unrelated re-render. The ref is the
  // standard way out — refreshed in its own effect rather than during render,
  // which React forbids, and declared FIRST so it is always up to date by the
  // time the debounce effect below runs.
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  });
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => applyRef.current(), debounceMs);
    return () => window.clearTimeout(t);
  }, [draftKey, dirty, debounceMs]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      // Setting `open` fires onToggle, which flushes any pending change — one
      // path for every way of closing rather than one per trigger.
      const el = detailsRef.current;
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
        // opening/closing.
        if (e.target !== e.currentTarget) return;
        // Closing flushes whatever is still on the debounce. Nothing waits for
        // this any more; it only means a fast close can't outrun the timer.
        if (!e.currentTarget.open) applyRef.current();
      },
    },
  };
}
