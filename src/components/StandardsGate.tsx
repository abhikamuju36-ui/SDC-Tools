"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { BUTTON_SECONDARY, TOOLBAR_BTN, TOOLBAR_BTN_ACTIVE, TOOLBAR_BTN_NEUTRAL, TOOLBAR_MIN_W } from "@/components/ui/classnames";
import { verifyStandardSheetPassword } from "@/lib/standard-sheet-gate";
import {
  closeStandardsPrompt,
  hideStandardSheet,
  markStandardsUnlocked,
  readStandardsState,
  revealStandardSheet,
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

// ── Hide / Show, once already authorized (§76) ───────────────────────────────
//
// Replaces the toolbar's old `<form action={lockStandardSheet}>`, which cleared the
// unlock cookie and called `revalidatePath("/etc")` — a full re-render of the heaviest
// page in the app to hide six columns and a card, and the exact round trip §48 already
// removed from the OPPOSITE direction. Worse, it never told THIS store the reveal had
// ended, so `StandardFeesCard` — which decides its own visibility independently — kept
// showing whatever it last fetched. That mismatch is the bug this component fixes: one
// click now flips the SAME `hidden` flag every Standard Sheet consumer reads (see the
// note beside hideStandardSheet in lib/standards-reveal.ts for why that flag exists
// instead of reusing `unlocked`).
//
// Still a real `<form action={lockAction}>` underneath, not a bare button — a client
// that never hydrates falls through to the old behaviour (relock + full reload) rather
// than losing the control entirely, the same trade StandardsGate's own no-JS path makes
// for showing.
export function StandardsVisibilityToggle({ lockAction }: { lockAction: () => Promise<void> }) {
  const { hidden } = useSyncExternalStore(subscribeStandards, readStandardsState, serverStandardsState);
  return (
    <form action={lockAction}>
      <button
        type="submit"
        onClick={(e) => {
          // Once this handler runs, JS has hydrated and the click is fully handled
          // here — instant, no request of any kind — so the <form>'s own submission
          // (which WOULD relock and reload) must not also fire.
          e.preventDefault();
          if (hidden) revealStandardSheet();
          else hideStandardSheet();
        }}
        className={`${TOOLBAR_BTN} ${TOOLBAR_MIN_W} ${hidden ? TOOLBAR_BTN_NEUTRAL : TOOLBAR_BTN_ACTIVE} justify-center`}
        title={
          hidden
            ? "Show the Standard Sheet columns and the Standard Fees card again."
            : "Standard Sheet columns and the Standard Fees card are showing — click to hide them."
        }
      >
        {hidden ? "Show Standards" : "Standards"}
      </button>
    </form>
  );
}
