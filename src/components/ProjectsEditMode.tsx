"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { TOOLBAR_BTN, TOOLBAR_BTN_MUTED } from "@/components/ui/classnames";
import { countChanged } from "@/lib/dirty-form";
import { writeProjectsEditCookie } from "@/lib/projects-edit-cookie";

// Edit Mode for the Projects grid — read-only until someone deliberately turns
// it on, with the password asked for at the moment of turning it on. See
// projects-edit-mode.ts for the cookies and, more importantly, for the
// server-side guard that is the actual enforcement.
//
// ── One control, not three ──────────────────────────────────────────────────
// This briefly grew into a password box, an Unlock button and a separate Lock
// button sitting beside the switch, which put a third state on the toolbar —
// "unlocked but still read-only" — that nobody asked for and that leaked the
// restricted columns for as long as it lasted. It is one switch again
// (2026-08-02, by request): Read-only <-> Editing, password on the way in.
//
// There is no lingering unlocked state. Turning editing OFF clears the gate as
// well, so turning it back on always asks again. That is the point of folding
// them together — two cookies, but one thing a user can be in or out of.
//
// ── What is instant and what is not ─────────────────────────────────────────
// The switch flips CLIENT state, so the cells unlock or lock on the click. The
// original design stopped there, on the stated grounds that "nothing about the
// grid's CONTENT depends on the mode — the same rows, the same figures either
// way", and deliberately avoided a server round trip because rendering /quoted
// is nine sequential database queries (one of them to the Scheduler's MySQL).
//
// That is no longer true. The four restricted sections — PM, Manufacturing,
// Warranty Engineering, Warranty Shop — exist only while editing, and only the
// SERVER can add or remove them: hiding them in the browser would leave the
// hours sitting in the HTML, which is not hiding them. So the switch also fires
// router.refresh(), and the wait it costs only ever delays a COLUMN appearing
// or disappearing — never the ability to type.

type EditModeValue = {
  editing: boolean;
  // False when nobody is signed in — the switch renders as a dead "Read-only"
  // label rather than a control that can't work.
  mayEdit: boolean;
  pending: boolean;
  // Called once the password has been accepted by the API.
  enable: () => void;
  // Returns false if the user backed out of the unsaved-changes prompt.
  disable: () => Promise<boolean>;
};

const EditModeCtx = createContext<EditModeValue>({
  editing: false,
  mayEdit: false,
  pending: false,
  enable: () => {},
  disable: async () => true,
});

export function useProjectsEditMode(): EditModeValue {
  return useContext(EditModeCtx);
}

const GATE_URL = "/api/projects/gate";

export function ProjectsEditModeProvider({
  initialEditing,
  signedIn,
  initiallyUnlocked,
  children,
}: {
  // The cookies' values at render time, so a reload keeps you where you were.
  // Editing requires BOTH: the mode cookie and the gate.
  initialEditing: boolean;
  signedIn: boolean;
  initiallyUnlocked: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(initialEditing && signedIn && initiallyUnlocked);

  function enable() {
    setEditing(true);
    writeProjectsEditCookie(true);
    // The restricted columns don't exist in the current markup — only a server
    // render can add them.
    startTransition(() => router.refresh());
  }

  async function disable(): Promise<boolean> {
    // Leaving Edit Mode disables every input; anything typed and not saved is
    // still in the DOM, but the Save button is gone, so say so first rather
    // than let an afternoon's edits become unreachable behind a switch
    // labelled "Read-only". countChanged is the same dirty-check Save uses, so
    // this number is exactly what a save would have written.
    //
    // Reached through one of the grid's own cells, NOT document.querySelector
    // ("form") — the sidebar's sign-out form comes first in the DOM, so that
    // would have dirty-checked the wrong form and always found nothing.
    const form = document.querySelector<HTMLInputElement>("input[name^='quoted__']")?.form;
    const changed = form ? countChanged(form) : 0;
    if (changed > 0) {
      const ok = window.confirm(
        `${changed} unsaved change${changed === 1 ? "" : "s"} won't be saved if you leave Edit Mode.\n\nLeave anyway?`,
      );
      if (!ok) return false;
    }

    setEditing(false);
    writeProjectsEditCookie(false);
    // Relock the gate too, so the next Edit Mode asks for the password again.
    // Failure is survivable — the mode cookie is already cleared, so the server
    // won't render the restricted columns and won't accept a write either.
    try {
      await fetch(GATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lock" }),
      });
    } catch {
      // Ignored on purpose — see above.
    }
    startTransition(() => router.refresh());
    return true;
  }

  return (
    <EditModeCtx.Provider value={{ editing: editing && signedIn, mayEdit: signedIn, pending, enable, disable }}>
      {children}
    </EditModeCtx.Provider>
  );
}

// Wraps the grid. `disabled` on a fieldset cascades to every input, select and
// button inside it, which is how read-only mode reaches ~1,100 cells without the
// server having to render a prop onto each one — and, being client state, it
// takes effect on the click.
//
// The class list is fighting the fieldset's own UA styling: default margin,
// padding, border, and `min-inline-size: min-content`, the last of which would
// otherwise refuse to let the scroll container shrink below the full width of a
// 20-column table.
export function ProjectsEditFieldset({ children }: { children: ReactNode }) {
  const { editing } = useProjectsEditMode();
  return (
    <fieldset disabled={!editing} className="m-0 min-w-0 border-0 p-0">
      {children}
    </fieldset>
  );
}

// Renders its children only in Edit Mode — the Add Project and Save buttons. In
// read-only they'd be controls that can't do anything, and "Save" in particular
// implies there's something to save.
export function WhenEditing({ children }: { children: ReactNode }) {
  const { editing } = useProjectsEditMode();
  if (!editing) return null;
  return <>{children}</>;
}

// The toolbar switch — the ONLY gate control on this page. First in the row,
// and amber when on, because "this grid is live" is the one piece of state here
// nobody should have to discover by typing into it.
//
// Turning it on opens a password popover (the same shape as
// SubmitAndLockButton and EtcRatesButton). The password is checked by
// /api/projects/gate, never in the browser — a route handler rather than a
// server action because an action re-renders this whole route just to answer,
// and that took seconds. Turning it off needs no password.
export function ProjectsEditModeToggle() {
  const { editing, mayEdit, pending, enable, disable } = useProjectsEditMode();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [wrong, setWrong] = useState(false);
  const [checking, setChecking] = useState(false);
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

  if (!mayEdit) {
    return (
      <span className={`${TOOLBAR_BTN} ${TOOLBAR_BTN_MUTED} cursor-default`} title="Sign in to edit this grid — you're viewing it read-only">
        <LockIcon />
        Read-only
      </span>
    );
  }

  async function confirmPassword() {
    if (password.length === 0 || checking) return;
    setChecking(true);
    try {
      const res = await fetch(GATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlock", password }),
      });
      const result = (await res.json()) as { ok?: boolean };
      if (!result.ok) {
        setWrong(true);
        return;
      }
      setOpen(false);
      setPassword("");
      setWrong(false);
      enable();
    } catch {
      // A failed request is not a wrong password, and saying so would send
      // someone hunting for a password that was fine.
      window.alert("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }

  function onToggleClick() {
    if (editing) {
      void disable();
      return;
    }
    setPassword("");
    setWrong(false);
    setOpen((v) => !v);
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        // type="button" is load-bearing: this sits inside the grid's <form>
        // (QuotedSaveForm wraps the whole page), and a default submit button
        // here would fire a save on click.
        type="button"
        onClick={onToggleClick}
        aria-pressed={editing}
        aria-busy={pending}
        disabled={pending}
        title={
          editing
            ? "Turn editing off — back to read-only, and the PM, Manufacturing and Warranty columns are hidden again"
            : "Turn editing on — asks for the password, then unlocks the cells and shows the PM, Manufacturing and Warranty columns"
        }
        className={`${TOOLBAR_BTN} ${
          editing ? "border-sdc-yellow bg-sdc-yellow-bg text-sdc-navy" : "border-sdc-border bg-white text-sdc-gray-600 hover:bg-sdc-blue-light"
        } disabled:cursor-wait`}
      >
        <span aria-hidden className={`relative h-3.5 w-6 shrink-0 rounded-full transition-colors ${editing ? "bg-sdc-yellow" : "bg-sdc-gray-100"}`}>
          <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-all ${editing ? "left-3" : "left-0.5"}`} />
        </span>
        {editing ? "Editing" : "Read-only"}
        {/* The cells are already live/locked by now; this only says the column
            set is still catching up, so the switch doesn't look stuck. */}
        {pending && <span className="text-[10px] font-normal opacity-60">updating columns…</span>}
      </button>

      {open && !editing && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-sdc-border bg-white p-3 shadow-lg">
          <p className="mb-1 text-xs font-semibold text-sdc-navy">Enter password to edit</p>
          <p className="mb-2 text-[11px] leading-relaxed text-sdc-gray-600">
            Unlocks the cells and shows the PM, Manufacturing and Warranty (Engineering &amp; Shop) sections — in the grid and in
            the Sections filter.
          </p>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (wrong) setWrong(false); // stop shouting as soon as they retype
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Enter in a text input submits the enclosing form — which here
                // is the GRID's. Stop it before it saves.
                e.preventDefault();
                void confirmPassword();
              }
            }}
            placeholder="Password"
            aria-label="Projects edit password"
            aria-invalid={wrong || undefined}
            disabled={checking}
            className={`w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:border-sdc-blue disabled:opacity-60 ${
              wrong ? "border-sdc-red" : "border-sdc-border"
            }`}
          />
          {wrong && <p className="mt-2 text-xs font-medium text-sdc-red-text">Wrong password</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="rounded-md px-3 py-1.5 text-sm text-sdc-gray-600 hover:bg-sdc-gray-100" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmPassword()}
              disabled={password.length === 0 || checking}
              className="rounded-md bg-sdc-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-sdc-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checking ? "Checking…" : "Start editing"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 opacity-70">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
      <path d="M5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7" strokeLinecap="round" />
    </svg>
  );
}
