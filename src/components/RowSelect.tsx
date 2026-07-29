"use client";

import { useEffect } from "react";

// Excel-style row selection: clicking anywhere in a data row highlights that
// whole row and clears any other selection in the same table — clicking the
// "#" row-number cell specifically (standing in for Excel's row-header
// gutter) also toggles it back off. Clicking anything outside a data row
// (the toolbar, page background, another table's header) clears whatever was
// selected, same as Excel losing its cell selection when focus leaves the
// grid. One document-level listener, like ExcelCellFocus, covers every table
// app-wide including server-rendered rows with no client handlers of their own.
export default function RowSelect() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const row = target.closest("tbody tr");
      const table = row?.closest("table");
      if (!row || !table) {
        document.querySelectorAll("tr.row-selected").forEach((r) => r.classList.remove("row-selected"));
        return;
      }

      const isRowNumberCell = !!target.closest("td:first-child");
      const wasSelected = row.classList.contains("row-selected");
      document.querySelectorAll("tr.row-selected").forEach((r) => r.classList.remove("row-selected"));
      if (!(isRowNumberCell && wasSelected)) row.classList.add("row-selected");
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
