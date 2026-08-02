"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { TOOLBAR_BTN, TOOLBAR_BTN_MUTED } from "@/components/ui/classnames";
import { countChanged } from "@/lib/dirty-form";
import { writeProjectsEditCookie } from "@/lib/projects-edit-cookie";

// Edit Mode for the Projects grid — read-only until someone deliberately turns
// it on. See projects-edit-mode.ts for the cookie and, more importantly, for the
// server-side guard that is the actual enforcement.
//
// ── Why the switch is CLIENT state, not the cookie ──────────────────────────
// The first cut of this drove the whole grid off the server: the cookie decided
// `canEdit`, the page rendered every cell readOnly or not, and the toggle called
// a server action that revalidated /quoted. Correct, and unusable — one click
// re-ran the entire page (every job with its estimated hours and ETC entries,
// the shared views, the Scheduler lookup) before a single input unlocked. It
// read as a dead button for as long as that took.
//
// So the switch flips client state instead, which is instant, and writes the
// cookie in the background. Whether the controls accept input is a
// <fieldset disabled> away, with nothing re-rendered.
//
// ── ...and why it now refreshes anyway ──────────────────────────────────────
// That paragraph used to end "nothing about the grid's CONTENT depends on the
// mode — the same rows, the same figures either way". That stopped being true
// on 2026-08-02: the four restricted sections (PM, Manufacturing, and the two
// Warranties) are only rendered while editing, and they are rendered by the
// SERVER — hiding them client-side would leave the hours sitting in the HTML,
// which is not hiding them at all.
//
// So toggle() now fires router.refresh() as well. The instant part is kept
// where it matters: the cells unlock on the click, and the refresh only ever
// delays a COLUMN appearing or disappearing.
//
// The cookie still matters — it's what saveQuotedHours checks — but the browser
// writes it directly rather than through a server action. An action would have
// undone the whole point: Next re-renders the current route after every server
// action, so the click wouldn't settle until the entire page had re-rendered on
// the server. See projects-edit-mode.ts for why writing it client-side gives
// nothing away.

type EditModeValue = { editing: boolean; mayEdit: boolean; pending: boolean; toggle: () => void };

const EditModeCtx = createContext<EditModeValue>({ editing: false, mayEdit: false, pending: false, toggle: () => {} });

export function useProjectsEditMode(): EditModeValue {
  return useContext(EditModeCtx);
}

export function ProjectsEditModeProvider({
  initialEditing,
  mayEdit,
  children,
}: {
  // The cookie's value at render time, so a reload keeps you where you were.
  initialEditing: boolean;
  // False when nobody is signed in.
  mayEdit: boolean;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(initialEditing && mayEdit);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (!mayEdit) return;
    const next = !editing;
    if (!next) {
      // Leaving Edit Mode disables every input; anything typed and not saved is
      // still in the DOM, but the Save button is gone, so say so first rather
      // than let an afternoon's edits become unreachable behind a switch
      // labelled "Read-only". countChanged is the same dirty-check Save uses, so
      // this number is exactly what a save would have written.
      // Reached through one of the grid's own cells, NOT document.querySelector
      // ("form") — the sidebar's sign-out form comes first in the DOM, so that
      // would have dirty-checked the wrong form and always found nothing.
      const form = document.querySelector<HTMLInputElement>("input[name^='quoted__']")?.form;
      const changed = form ? countChanged(form) : 0;
      if (changed > 0) {
        const ok = window.confirm(
          `${changed} unsaved change${changed === 1 ? "" : "s"} won't be saved if you leave Edit Mode.\n\nLeave anyway?`
        );
        if (!ok) return;
      }
    }
    // Both instant, both local — the cells unlock on the click, which is the
    // whole reason this is client state.
    setEditing(next);
    writeProjectsEditCookie(next);
    // ...but the four restricted sections (PM, Mfg, the two Warranties) are
    // rendered by the SERVER off this cookie, and only appear while editing.
    // Hiding them in the browser wouldn't hide them — the hours would still be
    // in the HTML — so the server has to render the other set, which means a
    // refresh. Fired after the cookie is written, so the request carries it.
    //
    // This is the one thing the original design deliberately avoided, and the
    // cost is real: the page re-renders every job with its hours. It is
    // narrowed as far as it can be — the cells are already live by the time
    // this lands, so the wait only ever delays a COLUMN appearing or
    // disappearing, never the ability to type.
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    // `editing && mayEdit`, not the raw state. mayEdit is a prop, so it drops to
    // false the moment the password gate is locked from the toolbar — and the
    // state, seeded once by useState, would otherwise still say true. That left
    // a locked page with live cells and a Save button (which the server would
    // then refuse), because ProjectsGateControl swaps the TOGGLE out but
    // WhenEditing and ProjectsEditFieldset read this context.
    <EditModeCtx.Provider value={{ editing: editing && mayEdit, mayEdit, pending, toggle }}>
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

// The toolbar switch itself. First control in the row, and amber when on,
// because "this grid is live" is the one piece of state on this page nobody
// should have to discover by typing into it.
export function ProjectsEditModeToggle() {
  const { editing, mayEdit, pending, toggle } = useProjectsEditMode();

  if (!mayEdit) {
    return (
      <span className={`${TOOLBAR_BTN} ${TOOLBAR_BTN_MUTED} cursor-default`} title="Sign in to edit this grid — you're viewing it read-only">
        <LockIcon />
        Read-only
      </span>
    );
  }

  return (
    <button
      // type="button" is load-bearing: this sits inside the grid's <form>, and a
      // default submit button here would fire a save on click.
      type="button"
      onClick={toggle}
      aria-pressed={editing}
      aria-busy={pending}
      title={
        editing
          ? "Turn editing off — the grid goes back to read-only and the PM, Manufacturing and Warranty columns are hidden"
          : "Turn editing on — cells become editable, Save appears, and the PM, Manufacturing and Warranty columns become available"
      }
      className={`${TOOLBAR_BTN} ${
        editing ? "border-sdc-yellow bg-sdc-yellow-bg text-sdc-navy" : "border-sdc-border bg-white text-sdc-gray-500 hover:bg-sdc-blue-light"
      }`}
    >
      <span aria-hidden className={`relative h-3.5 w-6 shrink-0 rounded-full transition-colors ${editing ? "bg-sdc-yellow" : "bg-sdc-gray-100"}`}>
        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-all ${editing ? "left-3" : "left-0.5"}`} />
      </span>
      {editing ? "Editing" : "Read-only"}
      {/* The cells are already live/locked by now; this only says the column
          set is still catching up, so the switch doesn't look stuck. */}
      {pending && <span className="text-[10px] font-normal opacity-60">updating columns…</span>}
    </button>
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
