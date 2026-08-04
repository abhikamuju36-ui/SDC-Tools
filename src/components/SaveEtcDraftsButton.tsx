"use client";

import { useEffect, useTransition } from "react";
import { saveAllNewEtcDrafts } from "@/lib/etc-actions";
import { isEtcDirty, rebaselineEtcFields } from "@/lib/etc-dirty-tracker";
import { useToast } from "@/components/ui/Toast";

// Batch-saves every currently-typed New ETC override across the grid in one click. The
// whole grid already lives in one <form> (formId), so this reads its current values via
// FormData rather than tracking them itself.
//
// ── No password popover any more (2026-08-04) ────────────────────────────────
// This button used to open a password prompt the first time each browser session, and
// that is what lost people's work. Reported twice as "Save is not working": a manager
// would type values, click Save, get a popover instead of a save, and the values were
// gone on the next refresh. The audit log confirmed it — zero draft saves across the
// hours it was being reported.
//
// The gate protected nothing. A draft commits nothing: needsReview stays true and
// Submit ETC — still password-gated, still confirmed every single time — is what turns
// a draft into history. Refusing to STORE a manager's typing only risked losing it.
//
// EtcAutosave now also runs unconditionally on an unlocked month, so this button is a
// "save now" rather than the only thing that persists anything.
//
// A beforeunload listener still warns (native browser dialog, same as Word/Excel) if
// anything has been typed since the last successful save — kept as the last line of
// defence even though autosave should mean it rarely fires.
export function SaveEtcDraftsButton({
  formId,
  month,
  className,
}: {
  formId: string;
  month: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  // Warn on a real browser-level unload (tab close, refresh, typed URL) if anything
  // typed hasn't gone through a save yet. Client-side app navigation (e.g. the month
  // picker) doesn't fire this — only actual document unloads do.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!isEtcDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function run() {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    const fd = new FormData(form);
    startTransition(async () => {
      const result = await saveAllNewEtcDrafts(month, fd);
      if (result.ok) {
        // Re-baseline rather than just clearing a flag: the values that were just
        // persisted become what "unchanged" means from here on. Clearing alone would
        // leave each cell compared against what the PAGE loaded with, so typing a cell
        // back to its pre-save value would read as clean when it's now a real unsaved
        // edit. `fd` is exactly what was posted, so it is exactly the right new baseline.
        rebaselineEtcFields(fd);
        // Say what happened. This action deliberately doesn't revalidate (it runs on
        // every autosave pass and re-rendering the whole month is what made saving feel
        // slow), so without this the button went "Saving…" and then back to "Save" with
        // nothing else on screen changing. "No changes" is stated out loud rather than
        // shown as a success, because a manager who expected to save something needs to
        // know the difference.
        toast(
          result.saved > 0
            ? `Saved ${result.saved} New ETC value${result.saved === 1 ? "" : "s"}.`
            : "Nothing to save — no New ETC values have changed.",
          result.saved > 0 ? "success" : "info",
        );
      } else {
        // The action no longer has a password to reject, so a false here means it
        // genuinely could not write. Say so rather than failing silently — the whole
        // point of this change is that typed work is never lost quietly.
        toast("Could not save — nothing was written. Please try again.", "error");
      }
    });
  }

  return (
    <button type="button" className={className} disabled={pending} onClick={run}>
      {pending ? "Saving…" : "Save"}
    </button>
  );
}
