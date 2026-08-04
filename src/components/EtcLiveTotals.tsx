"use client";

import { useEffect } from "react";
import { readEtcLiveTotals, readEtcLiveFooterTotals, subscribeEtcLiveTotals } from "@/lib/etc-live-totals";
// `usd` is byte-identical to etc/page.tsx's local currency() — same options, same
// output — so the Parts Cost footer keeps formatting exactly as the server
// rendered it rather than through a fourth private copy of the formatter.
import { hours as formatHours, usd as formatUsd } from "@/components/ui/format";
import { diffCellStyle, diffTotalStyle, DIFF_CEILING } from "@/components/ui/etc-diff-colors";

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
//
// ── No monthComplete prop any more (2026-08-04) ─────────────────────────────
// It used to take one, and used it to render "—" instead of the Total New ETC
// figure until the month's actuals were complete. That is why the bottom totals
// "were not updating": on an in-progress month every New ETC total was a dash, and
// no amount of typing could move a dash. The gate belongs on the CELLS (where it
// stops a partial figure looking final — see newEtcSeedText) and never on a total,
// whose whole contract is to equal the sum of what is displayed above it.
export function EtcLiveTotals() {
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
        // The Parts Cost row's own Diff. Repainted from the published parts cell because
        // that cell's input lives in a client component while its Diff <td> is rendered by
        // the page — so unlike the hours columns, local state cannot reach it.
        if (t.parts) writePartsRowDiff(String(jobId), t.parts.diff, t.parts.decided);
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

      // ── The rest of the <tfoot> ──────────────────────────────────────────
      // The per-section grand total is the figure directly beneath the cell
      // being typed, and it had no hook at all until 2026-08-03 — so the most
      // closely watched total on the page was the one that never moved. Parts
      // Cost's footer had the same gap despite its New ETC column being
      // editable. See lib/etc-live-totals.ts.
      const footer = readEtcLiveFooterTotals();
      for (const [sectionCode, t] of footer.sections) {
        writeSection(sectionCode, "newEtc", t.newEtc);
        writeSection(sectionCode, "diff", t.diff);
      }
      writeParts("partsNewEtc", footer.parts.newEtc);
      writeParts("partsDiff", footer.parts.diff);
    };

    // Repaint a Diff cell's COLOUR, not just its number.
    //
    // Without this the number moved and the colour didn't, so a total that crossed
    // zero kept the colour of the value it used to hold — "-124" still tinted green
    // as though it were under plan. A number and a colour contradicting each other is
    // worse than either being stale alone, because the colour is what gets read at a
    // glance on a grid this dense.
    //
    // The colour is a magnitude gradient, so it is an inline style rather than a
    // class — the same computed value the server render applies (etc-diff-colors.ts).
    // Both properties are cleared before reapplying, because an empty style object is
    // how "no variance" is expressed and a leftover colour would survive it.
    const paintDiffColor = (cell: HTMLElement, value: number, onDark: boolean, ceiling: number) => {
      const style = onDark ? diffTotalStyle(value, ceiling) : diffCellStyle(value, ceiling);
      cell.style.backgroundColor = "backgroundColor" in style && style.backgroundColor ? style.backgroundColor : "";
      cell.style.color = style.color ?? "";
      cell.style.fontWeight = "fontWeight" in style && style.fontWeight ? String(style.fontWeight) : "";
    };

    const write = (job: string, group: string, kind: "newEtc" | "diff", value: number) => {
      const cell = document.querySelector<HTMLElement>(`[data-live="${kind}"][data-group="${group}"][data-job="${job}"]`);
      if (!cell) return; // row filtered out, or this group's columns hidden
      // A TOTAL always shows its sum (2026-08-04). It used to render "—" until the
      // month's actuals were complete, which is why the bottom totals "were not
      // updating": on any in-progress month the New ETC totals were a dash that no
      // amount of typing could move. A total's contract is to equal the sum of the
      // values displayed above it — see the note in etc/page.tsx.
      cell.textContent = formatHours(value);
      cell.setAttribute("title", String(Math.round(value * 100) / 100));
      // Body rows colour the cell background; the footer row (data-job="all") is dark
      // and colours the text instead. Both are hours rollups, so both scale against
      // the same ceiling — matching what the server rendered for these cells.
      if (kind === "diff") paintDiffColor(cell, value, job === "all", DIFF_CEILING.hoursTotal);
    };

    // Per-section footer totals. Keyed on the section code alone — there is one
    // footer row, so no job dimension. The selector deliberately shares nothing
    // with the group hooks above (those require data-group + data-job), so the
    // two can never match each other's cells.
    const writeSection = (sectionCode: string, kind: "newEtc" | "diff", value: number) => {
      const cell = document.querySelector<HTMLElement>(`[data-live="${kind}"][data-section="${sectionCode}"]`);
      if (!cell) return; // column hidden by the Columns filter
      cell.textContent = formatHours(value);
      cell.setAttribute("title", String(Math.round(value * 100) / 100));
      // Always in the dark <tfoot> — there is only one footer row.
      if (kind === "diff") paintDiffColor(cell, value, true, DIFF_CEILING.hoursTotal);
    };

    // The Parts Cost row Diff — dollars, in the BODY, so it colours a background like the
    // hours cells rather than text like the footer. Prints "—" when nothing is decided,
    // matching the server render: with no New ETC chosen there is no variance, and "$0"
    // would read as "on plan".
    // ALWAYS a figure (2026-08-04, by request): Diff = Money Left − New ETC, with a
    // blank New ETC counting as 0. It used to print "—" while nothing was decided;
    // `decided` now only affects nothing here, but is still received because the
    // publisher carries it for the cell background.
    const writePartsRowDiff = (job: string, value: number, _decided: boolean) => {
      const cell = document.querySelector<HTMLElement>(`[data-live="partsRowDiff"][data-job="${job}"]`);
      if (!cell) return; // Parts Cost column hidden, or this job has no parts row
      cell.textContent = formatUsd(value);
      cell.setAttribute(
        "title",
        value.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      );
      paintDiffColor(cell, value, false, DIFF_CEILING.moneyCell);
    };

    // Parts Cost footer — dollars, not hours, and one cell each.
    const writeParts = (kind: "partsNewEtc" | "partsDiff", value: number) => {
      const cell = document.querySelector<HTMLElement>(`[data-live="${kind}"]`);
      if (!cell) return;
      cell.textContent = formatUsd(value);
      cell.setAttribute("title", value.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      if (kind === "partsDiff") paintDiffColor(cell, value, true, DIFF_CEILING.moneyTotal);
    };

    paint();
    return subscribeEtcLiveTotals(paint);
  }, []);

  return null;
}
