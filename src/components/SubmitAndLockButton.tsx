"use client";

import { useEffect, useRef, useState } from "react";
import { rebaselineEtcFields } from "@/lib/etc-dirty-tracker";

// Submit ETC freezes a month's ETC ENTRIES — Hours Worked and New ETC
// on every row. NOT the same thing as the Standard Fees panel's "Submit
// Standard Sheet", which freezes the per-job fee dollars into
// StandardSheetSnapshot; a month can be locked on one and open on the other,
// and July 2026 was exactly that when someone asked why there were two.
// Labelled "ETC" for that reason.
//
// It is gated behind a password prompt as a deliberate "are you sure" step — not a security
// boundary (the real check is server-side in submitMonth). A popover rather
// than window.prompt() to match the app's own look (see EtcRatesButton for
// the same pattern). Confirming fills a hidden input on the target form and
// calls requestSubmit — the confirmation has to happen BEFORE the form ever
// submits, so this can't just be a type="submit" button.
export function SubmitAndLockButton({ formId, className }: { formId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  function confirm() {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;

    let input = form.elements.namedItem("submitLockPassword") as HTMLInputElement | null;
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = "submitLockPassword";
      form.appendChild(input);
    }
    input.value = password;
    // Submitting persists every typed New ETC too (submitMonth reads the same
    // `newEtcOverride__<id>` fields Save does), so the grid is no longer
    // "unsaved" afterwards. Without this the unsaved-changes guards kept
    // firing on a month that had just been locked — the inputs are disabled at
    // that point, so there was no way to clear it short of a full reload.
    // Snapshot before requestSubmit: the submission navigates.
    rebaselineEtcFields(new FormData(form));
    form.requestSubmit();
    setOpen(false);
    setPassword("");
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className={className}
        onClick={() => {
          setPassword("");
          setOpen((v) => !v);
        }}
      >
        Submit ETC
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-sdc-border bg-white p-3 shadow-lg">
          <p className="mb-1 text-xs font-semibold text-sdc-navy">Enter password to Submit ETC</p>
          {/* Names what it freezes. The Standard Fees panel has its own
              "Submit Standard Sheet", and until this said "ETC" the two
              were indistinguishable on screen — a user asked why the same
              button existed twice (2026-08-02). They freeze different tables:
              this one EtcEntry, that one StandardSheetSnapshot. */}
          <p className="mb-2 text-[11px] leading-relaxed text-sdc-gray-600">
            Freezes this month&apos;s Hours Worked and New ETC. The Standard Fees panel&apos;s Standard Sheet is submitted
            separately.
          </p>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
            }}
            placeholder="Password"
            aria-label="Submit ETC password"
            className="w-full rounded-md border border-sdc-border px-2 py-1.5 text-sm outline-none focus:border-sdc-blue"
          />
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
              onClick={confirm}
              disabled={password.length === 0}
              className="rounded-md bg-sdc-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-sdc-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
