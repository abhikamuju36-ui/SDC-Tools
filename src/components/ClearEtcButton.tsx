"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { clearYellowNewEtc } from "@/lib/etc-actions";
import { useToast } from "@/components/ui/Toast";

// Clear ETC — empties every YELLOW New ETC cell in the month, so the grid becomes
// a checklist of what still needs entering.
//
// Yellow means "nobody has decided this yet". On a first-pass month those cells are
// already blank and this does nothing; on a REOPENED month they arrive carrying the
// figure they were submitted with, and clearing them is how a manager makes the
// month ask its questions again. The cells STAY yellow afterwards — that is the
// point, not a side effect. Decided cells (a value somebody typed) are never
// touched, and neither is confirmed history.
//
// Gated by the confirmation phrase EVERY time, with no session cookie — unlike
// Save's one-password-per-session gate. Erasing this many entered values in a click
// belongs with Reopen Month, not with a save. The count comes from the server render
// (`clearableCount`) so the prompt can say exactly how much is about to go, and the
// server recomputes it independently before writing anything.
export function ClearEtcButton({
  month,
  clearableCount,
  className,
}: {
  month: string;
  clearableCount: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [wrong, setWrong] = useState(false);
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
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

  function run() {
    const fd = new FormData();
    fd.set("clearEtcPassword", password);
    startTransition(async () => {
      const result = await clearYellowNewEtc(month, fd);
      if (!result.ok) {
        if (result.reason === "password") {
          // Keep the popover open so the message is attached to the box that
          // caused it, exactly like Save's gate.
          setWrong(true);
          return;
        }
        toast(
          result.reason === "locked"
            ? "This month is submitted and locked — reopen it first."
            : "Could not clear this month.",
          "error",
        );
        setOpen(false);
        return;
      }
      setOpen(false);
      setPassword("");
      setWrong(false);
      // This action DOES revalidate (unlike the draft save), so the grid repaints
      // with the cleared cells on its own. The toast is here to name the count —
      // "0" in particular needs saying out loud, because a month with nothing
      // undecided is indistinguishable from a button that didn't fire.
      toast(
        result.cleared > 0
          ? `Cleared ${result.cleared} New ETC value${result.cleared === 1 ? "" : "s"}. They are in the audit log if you need one back.`
          : "Nothing to clear — no undecided New ETC values are holding a figure.",
        result.cleared > 0 ? "success" : "info",
      );
    });
  }

  return (
    <div ref={wrapRef} className="relative">
      {/* Disabled when there is nothing to clear, rather than opening a prompt that
          dead-ends on a greyed Clear. Reported 2026-08-03: a successful clear of 181
          values left the button in exactly that state, and typing the password into a
          popover that then refused to act read as the button being broken — the same
          "it worked but nothing said so" trap as the original Save complaint. A
          disabled control with a reason on it is honest; an enabled one that leads
          nowhere is not. */}
      <button
        type="button"
        className={className}
        disabled={pending || clearableCount === 0}
        title={
          clearableCount === 0
            ? "Nothing to clear — every cell with hours worked this month already has a decision entered, or has been cleared already."
            : `Empty the ${clearableCount} New ETC cell${clearableCount === 1 ? "" : "s"} still awaiting a decision, so they can be re-entered.`
        }
        onClick={() => {
          setPassword("");
          setWrong(false);
          setOpen((v) => !v);
        }}
      >
        {/* The count is on the LABEL, not just the tooltip: "Clear ETC (181)" vs a
            greyed "Clear ETC" makes the difference between "there is work here" and
            "nothing is awaiting a decision" readable at a glance, without opening
            anything or hovering. */}
        {pending ? "Clearing…" : clearableCount > 0 ? `Clear ETC (${clearableCount})` : "Clear ETC"}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-80 rounded-lg border border-sdc-border bg-white p-3 shadow-lg">
          {/* No "nothing to clear" branch here: the button above is disabled at 0, so
              this popover only ever opens when there is something to act on. If the
              count goes stale (another clear lands between render and click) the
              server returns 0 and the toast says so. */}
          <p className="mb-1 text-xs font-semibold text-sdc-navy">
            Clear {clearableCount} New ETC value{clearableCount === 1 ? "" : "s"}?
          </p>
          <p className="mb-2 text-[11px] leading-relaxed text-sdc-gray-600">
            Empties only the <span className="font-semibold">yellow</span> cells — the ones still awaiting a decision.
            Values you have already entered are left alone, and so is submitted history. The cleared figures are
            written to the audit log.
          </p>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setWrong(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
            }}
            placeholder="Password"
            aria-label="Clear ETC password"
            className="w-full rounded-md border border-sdc-border px-2 py-1.5 text-sm outline-none focus:border-sdc-blue"
          />
          {wrong && <p className="mt-2 text-xs text-red-600">Wrong password — nothing was cleared.</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-sm text-sdc-gray-600 hover:bg-sdc-gray-100"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={run}
              disabled={password.length === 0 || pending}
              className="rounded-md border border-sdc-red-border bg-sdc-red-bg px-3 py-1.5 text-sm font-semibold text-sdc-red-text hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Clearing…" : "Clear"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
