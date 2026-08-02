"use client";

import { useState, useTransition } from "react";
import { TOOLBAR_BTN, TOOLBAR_BTN_MUTED } from "@/components/ui/classnames";
import { ProjectsEditModeToggle } from "@/components/ProjectsEditMode";
import { unlockProjects, lockProjects } from "@/lib/projects-gate";

// The first control on the Projects toolbar: either the password box (locked)
// or the Edit Mode switch plus a way back out (unlocked).
//
// ── Why this is NOT a <form action={unlockProjects}> ────────────────────────
//
// Because it would silently do the wrong thing. QuotedSaveForm wraps this
// entire page — toolbar included — in the grid's own <form>, and nested forms
// are invalid HTML: the parser DROPS the inner <form> tag and re-parents its
// children. The password input and an "Unlock" submit button would both end up
// belonging to the outer form, so clicking Unlock would post the whole grid to
// saveQuotedHours — which, now that assertProjectsEditable() checks this gate,
// answers "Projects is locked". A button that reports the very thing it exists
// to fix. (Written after exactly that shipped and was caught on review; the
// same hazard is why ProjectsEditModeToggle is careful to be type="button".)
//
// So both controls are plain buttons that call the server action directly with
// a hand-built FormData. No nesting, nothing submitted but the password, and
// useTransition gives the pending state a form submission would have provided.
export function ProjectsGateControl({ unlocked }: { unlocked: boolean }) {
  const [password, setPassword] = useState("");
  const [wrong, setWrong] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (password.length === 0 || pending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("password", password);
      const result = await unlockProjects(fd);
      if (result.ok) {
        // On success the action revalidates and this whole subtree is replaced
        // by the unlocked branch — clearing the field is just hygiene, so the
        // typed password isn't sitting in a detached React tree.
        setPassword("");
        setWrong(false);
      } else {
        setWrong(true);
      }
    });
  }

  if (!unlocked) {
    return (
      <div className="flex items-center gap-1.5">
        <span
          className={`${TOOLBAR_BTN} ${TOOLBAR_BTN_MUTED} cursor-default`}
          // Unlocking alone does NOT reveal the restricted sections — they
          // follow Edit Mode, which unlocking merely makes available. Saying
          // "show the ... sections" here would have someone typing the password
          // and then wondering where the columns were.
          title="Enter the password to enable Edit Mode, which also makes the PM, Manufacturing and Warranty sections available"
        >
          <LockIcon />
          Locked
        </span>
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (wrong) setWrong(false); // stop shouting as soon as they retype
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // The Enter key inside a text input submits the enclosing form —
              // which here is the GRID's form. Stop it before it saves.
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Password"
          aria-label="Projects password"
          aria-invalid={wrong || undefined}
          disabled={pending}
          className={`h-8 w-32 rounded-md border px-2 text-xs text-sdc-navy outline-none focus:border-sdc-blue disabled:opacity-60 ${
            wrong ? "border-sdc-red" : "border-sdc-border"
          }`}
        />
        <button
          // type="button", not submit: see the note at the top of this file.
          type="button"
          onClick={submit}
          disabled={password.length === 0 || pending}
          className={`${TOOLBAR_BTN} border-sdc-border bg-white text-sdc-navy hover:bg-sdc-blue-light disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {pending ? "Unlocking…" : "Unlock"}
        </button>
        {wrong && <span className="text-xs font-medium text-sdc-red-text">Wrong password</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <ProjectsEditModeToggle />
      <button
        type="button"
        onClick={() => startTransition(async () => void (await lockProjects()))}
        disabled={pending}
        className={`${TOOLBAR_BTN} border-sdc-border bg-white text-sdc-gray-600 hover:bg-sdc-blue-light disabled:opacity-50`}
        title="Lock this grid again — hides the PM, Manufacturing and Warranty sections and turns editing off"
      >
        <LockIcon />
        {pending ? "Locking…" : "Lock"}
      </button>
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
