"use client";

import { useEffect } from "react";
import { readEtcLiveTotals, subscribeEtcLiveTotals } from "@/lib/etc-live-totals";
import { hours as formatHours } from "@/components/ui/format";

// Repaints the Monthly ETC grid's rollup cells from the live store as New ETC
// values are typed — the row's TOTAL (NEW ETC) block and the sticky grand-total
// row in <tfoot>.
//
// See lib/etc-live-totals.ts for why: every one of those figures is summed on the
// server, so a manager confirming cell by cell watched each Diff update correctly
// while the totals they were about to Submit sat frozen at page load.
//
// ── Only two cells per block move ───────────────────────────────────────────
// Prior ETC and Hours Worked are not editable here (Hours Worked auto-syncs from
// the hours feed), and Hours Left derives from those two. So typing a New ETC can
// only change Total New ETC and Diff. Repainting just those keeps this narrow and
// makes it obvious what it can and cannot get wrong.
//
// ── Why DOM writes and not React ────────────────────────────────────────────
// The rows are server-rendered precisely so ~800 cells stay out of the client
// bundle. Re-rendering them through React on every keystroke is the cost that
// choice exists to avoid, so the totals are patched in place instead — the same
// approach as ProjectsLiveTotals on the Projects grid.
//
// It never invents a number: it only sums what the cells published, and the cells
// publish what they themselves computed with lib/etc.ts. A live total therefore
// cannot disagree with the figures above it, or with what Submit persists.
export function EtcLiveTotals({ monthComplete }: { monthComplete: boolean }) {
  useEffect(() => {
    const paint = () => {
      const totals = readEtcLiveTotals();

      // Grand totals are re-summed from the same per-job figures rather than
      // accumulated separately, so the footer can't drift from the rows it sums.
      const grand = {
        Engineering: { newEtc: 0, diff: 0 },
        Shop: { newEtc: 0, diff: 0 },
      };

      for (const [jobId, t] of totals) {
        for (const group of ["Engineering", "Shop"] as const) {
          const g = group === "Engineering" ? t.engineering : t.shop;
          grand[group].newEtc += g.newEtc;
          grand[group].diff += g.diff;
          write(String(jobId), group, "newEtc", g.newEtc);
          write(String(jobId), group, "diff", g.diff);
        }
      }
      for (const group of ["Engineering", "Shop"] as const) {
        write("all", group, "newEtc", grand[group].newEtc);
        write("all", group, "diff", grand[group].diff);
      }
    };

    const write = (job: string, group: string, kind: "newEtc" | "diff", value: number) => {
      const cell = document.querySelector<HTMLElement>(`[data-live="${kind}"][data-group="${group}"][data-job="${job}"]`);
      if (!cell) return; // row filtered out, or this group's columns hidden
      // Total New ETC renders "—" until the month's actuals are complete, exactly
      // as the server does — blanking it is a deliberate statement that the figure
      // isn't final yet, and a live value must not quietly override it.
      cell.textContent = kind === "newEtc" && !monthComplete ? "—" : formatHours(value);
      cell.setAttribute("title", String(Math.round(value * 100) / 100));
    };

    paint();
    return subscribeEtcLiveTotals(paint);
  }, [monthComplete]);

  return null;
}
