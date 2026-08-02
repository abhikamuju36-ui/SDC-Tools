"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { nextParams, notePendingParams } from "@/lib/url-params";
import { isShowingAll, encodeParamList, ACTUALS_PARAM, QUOTED_VIEW_PARAMS } from "@/lib/quoted-display-prefs";

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

  // Whether everything is showing is derived from the URL alone — actuals
  // included, now that it's a view param — and never held as state, so the
  // switch stays truthful when someone changes a filter by hand or applies a
  // saved view. isShowingAll is in the lib, pure and unit-tested, because its
  // absent-param asymmetry is easy to break.
  const all = {
    customers: allCustomers,
    types: allTypes,
    statuses: allStatuses,
    billables: allBillables,
    cols: allSectionCodes,
  };
  const showingAll = isShowingAll(searchParams, all);

  function flip() {
    // See lib/url-params.ts. Reset in particular must build on whatever is
    // actually in flight: clearing the view params off a stale base would put
    // back a filter the user had just changed.
    const currentQs = searchParams.toString();
    const qs = nextParams(currentQs);
    if (showingAll) {
      // Reset: drop every view param so the page's own defaults apply again —
      // `actuals` among them, so hiding the actual hours is part of the same
      // single navigation rather than a separate write that has to keep up.
      for (const p of QUOTED_VIEW_PARAMS) qs.delete(p);
    } else {
      // encodeParamList, not join(",") — customer names contain commas, and a
      // raw join made "Show all" hide those jobs and leave the switch reading OFF.
      qs.set("customers", encodeParamList(allCustomers));
      qs.set("types", encodeParamList(allTypes));
      qs.set("statuses", encodeParamList(allStatuses));
      qs.set("billables", encodeParamList(allBillables));
      qs.set("cols", encodeParamList(allSectionCodes));
      qs.delete("hide"); // nothing hidden
      qs.set(ACTUALS_PARAM, "1"); // actual hours in the cells
    }
    const q = qs.toString();
    notePendingParams(currentQs, q);
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
