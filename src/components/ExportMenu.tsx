"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { flushEtcAutosave, isEtcDirty } from "@/lib/etc-dirty-tracker";

// ── Export ▾ (§24.1) ─────────────────────────────────────────────────────────
//
// One control on both pages: a button that opens Excel / CSV. It sends the page's OWN
// query string to /api/export/<report>, which is what makes the file match the table
// (§24.2) — the filters are not re-described here, they are simply forwarded.
//
// ── Why fetch + blob rather than a plain <a download> ───────────────────────
//
// A link is simpler and was the first version, but it cannot do three of the required
// things: it gives no progress state, it cannot tell success from failure (a 500 lands
// in a download slot and looks like nothing happened), and it cannot wait for the
// autosave to flush first. So the file is fetched, the response is checked, and only
// then is it handed to the browser as a download.
//
// The page never navigates and never reloads: the anchor is synthetic, revoked
// immediately, and the manager's filters, scroll position and open menus are untouched
// (§24.12).
export function ExportMenu({
  report,
  // Extra params the page owns that are not in the URL — the ETC month, which lives in
  // the query string already, is passed explicitly so a default month (no ?month=) still
  // exports the month on screen rather than the server's idea of "latest".
  fixedParams,
  // Wait for pending edits to land before exporting (§24.8). Only the ETC page has
  // autosaved cells feeding its export.
  flushBeforeExport = false,
  className,
}: {
  report: "projects" | "etc";
  fixedParams?: Record<string, string>;
  flushBeforeExport?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Which format is being prepared, so only that item shows a spinner and only the
  // export action is disabled — not the page (§24.9).
  const [busy, setBusy] = useState<"xlsx" | "csv" | null>(null);
  const searchParams = useSearchParams();
  const wrapRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(format: "xlsx" | "csv") {
    if (busy) return; // one click, one export (§24.13.20)
    setBusy(format);
    try {
      // The export reads the DATABASE, so anything still on the autosave debounce would
      // be missing from the file. Same step the monthly submission takes, same reason.
      if (flushBeforeExport && isEtcDirty()) await flushEtcAutosave();

      const qs = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(fixedParams ?? {})) if (!qs.has(k)) qs.set(k, v);
      qs.set("format", format);

      const res = await fetch(`/api/export/${report}?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        // The route returns a plain-text reason; showing it beats "export failed".
        throw new Error((await res.text()) || `The server returned ${res.status}.`);
      }
      const blob = await res.blob();
      // The filename the server chose (§24.10) — it knows the filters and the month.
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] ?? `export.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next tick: revoking synchronously can beat the download starting
      // in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast(`${a.download} downloaded.`, "success");
      setOpen(false);
    } catch (err) {
      toast(err instanceof Error ? `Export failed — ${err.message}` : "Export failed.", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className={className}
        disabled={busy !== null}
        onClick={() => setOpen((v) => !v)}
        title="Download this table as it is currently filtered"
      >
        {/* Reserved slot: "Export" and "Preparing…" are different widths, and this button
            sits mid-toolbar — swapping them shifted every control to its right (§36.3,
            §36.14). */}
        <span className="inline-flex min-w-[4.5rem] items-center justify-center">{busy ? "Preparing…" : "Export"}</span>
      </button>
      {open && (
        <div className="motion-menu-panel absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-sdc-border bg-white p-1 shadow-lg">
          {/* Says what the export contains, because "Export" alone leaves the reader
              guessing whether it is the filtered view or everything. */}
          <p className="px-2 py-1 text-label leading-snug text-sdc-gray-500">
            Exports the table as currently filtered, with every column — including the ones off-screen.
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run("xlsx")}
            className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-sdc-navy hover:bg-sdc-blue-light disabled:opacity-50"
          >
            Export to Excel
            <span className="text-label text-sdc-gray-400">{busy === "xlsx" ? "preparing…" : ".xlsx"}</span>
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run("csv")}
            className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-sdc-navy hover:bg-sdc-blue-light disabled:opacity-50"
          >
            Export to CSV
            <span className="text-label text-sdc-gray-400">{busy === "csv" ? "preparing…" : ".csv"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
