"use client";

import { useSyncExternalStore, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  readShowActuals,
  writeShowActuals,
  subscribeShowActuals,
  isShowingAll,
  QUOTED_VIEW_PARAMS,
} from "@/lib/quoted-display-prefs";

// "Show all" ⇄ "Reset" — one switch that flips the whole grid between the
// day-to-day view and everything-visible, instead of making someone walk three
// menus to see the same thing.
//
// ON  (Show all): every customer, type and status (so Complete and Non-Billable
//     jobs appear), every section column, every info column, and actual hours in
//     the cells.
// OFF (Reset):    back to the page's defaults — Active + Billable only, the
//     default hidden section codes, actuals off.
//
// Reset works by DELETING the params rather than writing "the default values"
// into them. On this grid an absent param means "no choice made yet, use the
// default", so deleting is what genuinely restores the default — and it leaves a
// clean, shareable URL instead of one carrying a spelled-out copy of the
// defaults. That distinction is load-bearing: `statuses=Active` and no
// `statuses` at all look the same today, but only the latter follows the default
// if it ever changes.
//
// The switch reads its own state from the URL rather than holding any, so it
// stays right when someone changes a filter by hand or opens a saved view.
export function ProjectsShowAllSwitch({
  allCustomers,
  allTypes,
  allStatuses,
  allBillables,
  allSectionCodes,
}: {
  allCustomers: string[];
  allTypes: string[];
  allStatuses: string[];
  allBillables: string[];
  allSectionCodes: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const actualsOn = useSyncExternalStore(subscribeShowActuals, readShowActuals, () => false);

  // Whether everything is showing is derived from the URL + the actuals flag,
  // never held as state — so the switch stays truthful when someone changes a
  // filter by hand or applies a saved view. isShowingAll is in the lib, pure and
  // unit-tested, because its absent-param asymmetry is easy to break.
  const all = {
    customers: allCustomers,
    types: allTypes,
    statuses: allStatuses,
    billables: allBillables,
    cols: allSectionCodes,
  };
  const showingAll = isShowingAll(searchParams, all, actualsOn);

  function flip() {
    const qs = new URLSearchParams(searchParams.toString());
    if (showingAll) {
      // Reset: drop every view param so the page's own defaults apply again.
      for (const p of QUOTED_VIEW_PARAMS) qs.delete(p);
      writeShowActuals(false);
    } else {
      qs.set("customers", allCustomers.join(","));
      qs.set("types", allTypes.join(","));
      qs.set("statuses", allStatuses.join(","));
      qs.set("billables", allBillables.join(","));
      qs.set("cols", allSectionCodes.join(","));
      qs.delete("hide"); // nothing hidden
      writeShowActuals(true);
    }
    const q = qs.toString();
    startTransition(() => {
      router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
    });
  }

  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={showingAll}
      title={
        showingAll
          ? "Back to the default view: Active + Billable jobs, default columns, actuals hidden"
          : "Show everything: all statuses and billable types, every column, actual hours in cells"
      }
      className={`flex h-8 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
        showingAll
          ? "border-sdc-blue bg-sdc-blue-light text-sdc-blue-dark"
          : "border-sdc-border bg-white text-sdc-navy hover:bg-sdc-blue-light"
      } ${pending ? "opacity-60" : ""}`}
    >
      {/* A real switch track, not another dropdown-looking pill: this is the one
          control on the toolbar that's binary, and it should look it. */}
      <span
        aria-hidden
        className={`relative h-3.5 w-6 shrink-0 rounded-full transition-colors ${
          showingAll ? "bg-sdc-blue" : "bg-sdc-gray-100"
        }`}
      >
        <span
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-all ${
            showingAll ? "left-3" : "left-0.5"
          }`}
        />
      </span>
      {showingAll ? "Reset" : "Show all"}
    </button>
  );
}
