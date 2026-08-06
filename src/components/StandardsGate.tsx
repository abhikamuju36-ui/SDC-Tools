"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { BUTTON_SECONDARY } from "@/components/ui/classnames";
import { verifyStandardSheetPassword } from "@/lib/standard-sheet-gate";
import {
  closeStandardsPrompt,
  markStandardsUnlocked,
  readStandardsState,
  serverStandardsState,
  subscribeStandards,
} from "@/lib/standards-reveal";

// The Standard Fees password box (§48).
//
// It used to be server-rendered, gated on a `?standards=1` URL flag, so OPENING it was a
// route navigation and SUBMITTING it was a `revalidatePath("/etc")`. Measured before this
// change: 6,077ms to open, 2,911ms and 190KB to submit — five full renders of the heaviest
// page in the app between a double-click and a visible card.
//
// Now: the box is local state, the gesture sets a boolean, and the submit calls one server
// action that answers `{ ok }`. Nothing else on the page is asked to re-render, which is
// how the grid's scroll position, filters, focused cell and unsaved edits survive — not by
// preserving them, but by never disturbing them.
export function StandardsGate({
  /** True when the request that rendered this page already carried the unlock cookie. */
  initiallyUnlocked,
}: {
  initiallyUnlocked: boolean;
}) {
  const { promptOpen, unlocked } = useSyncExternalStore(
    subscribeStandards,
    readStandardsState,
    serverStandardsState,
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the box when it opens, so the gesture ends with a cursor in the field and the
  // password can be typed without a further click. Not on every render — only on the
  // transition to open.
  useEffect(() => {
    if (promptOpen) inputRef.current?.focus();
  }, [promptOpen]);

  // Already unlocked when the page rendered, or unlocked in this tab: there is nothing
  // for this component to offer. The reveal itself belongs to whatever renders the card.
  if (initiallyUnlocked || unlocked || !promptOpen) return null;

  function submit() {
    const attempt = inputRef.current?.value ?? "";
    setError(null);
    startTransition(async () => {
      // ── One in-flight attempt, and stale answers are impossible ──────────────
      //
      // useTransition's `pending` is what disables the button, so a second submit cannot
      // be started while the first is out. There is therefore never more than one reply
      // in flight to go stale — the dedupe §48 asks for, without a request-id dance.
      let ok = false;
      try {
        ({ ok } = await verifyStandardSheetPassword(attempt));
      } catch {
        // A failed action is not a wrong password, and saying "wrong password" to
        // somebody who typed the right one is the worst possible message. §48: never
        // leave the button stuck — the transition ends either way, so the control comes
        // back regardless of which branch this takes.
        setError("Couldn't check that just now. Try again.");
        return;
      }
      if (ok) {
        // Reveal on this frame. No navigation, no refetch, no server render.
        markStandardsUnlocked();
        return;
      }
      setError("Wrong password");
      // Keep the box open and the cursor in it, per §48's failure requirement.
      inputRef.current?.select();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="password"
        // No `name`, and no enclosing <form>: this never round-trips as form data, so a
        // named field would only offer the browser somewhere to remember the phrase.
        placeholder="Password"
        aria-label="Standard Sheet password"
        aria-invalid={error != null}
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") closeStandardsPrompt();
        }}
        className="w-32 rounded-md border border-sdc-border px-2 py-1.5 text-sm outline-none focus:border-sdc-blue"
      />
      <button
        type="button"
        onClick={submit}
        // ONLY this button (§48: "disable only the Show Standards button during
        // validation"). The rest of the page is untouched — the grid stays editable while
        // the check is out.
        disabled={pending}
        className={BUTTON_SECONDARY}
        title="Show the Standard Fees card and columns for this month (requires password)."
      >
        {pending ? "Checking…" : "Show Standards"}
      </button>
      {/* aria-live so the failure is announced, not just coloured. */}
      <span className="text-note text-sdc-red-text" role="status" aria-live="polite">
        {error}
      </span>
    </div>
  );
}
