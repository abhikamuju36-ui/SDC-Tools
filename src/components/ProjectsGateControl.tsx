"use client";

import { useState } from "react";
import { TOOLBAR_BTN, TOOLBAR_BTN_MUTED } from "@/components/ui/classnames";
import { ProjectsEditModeToggle, useProjectsEditMode } from "@/components/ProjectsEditMode";

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
// So both controls are plain buttons. They POST to /api/projects/gate rather
// than calling a server action — an action would make Next re-render /quoted,
// which is nine sequential database round trips and made "Unlocking..." sit
// there for seconds. The route handler just sets the cookie; the toolbar swaps
// on client state held by ProjectsEditModeProvider.
export function ProjectsGateControl() {
  const { unlocked, onUnlocked, lock } = useProjectsEditMode();
  const [password, setPassword] = useState("");
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (password.length === 0 || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/projects/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlock", password }),
      });
      const result = (await res.json()) as { ok?: boolean };
      if (result.ok) {
        setPassword("");
        setWrong(false);
        onUnlocked();
      } else {
        setWrong(true);
      }
    } catch {
      // Network/route failure is not a wrong password, and saying so would send
      // someone hunting for a password that was fine.
      setWrong(false);
      window.alert("Couldn't reach the server to unlock. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function doLock() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/projects/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lock" }),
      });
    } finally {
      setBusy(false);
      // Locally regardless: if the request failed the cookie is still set, but
      // the next write would be refused by the server anyway, and leaving the
      // toolbar claiming "unlocked" after someone clicked Lock is worse.
      lock();
    }
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
          disabled={busy}
          className={`h-8 w-32 rounded-md border px-2 text-xs text-sdc-navy outline-none focus:border-sdc-blue disabled:opacity-60 ${
            wrong ? "border-sdc-red" : "border-sdc-border"
          }`}
        />
        <button
          // type="button", not submit: see the note at the top of this file.
          type="button"
          onClick={submit}
          disabled={password.length === 0 || busy}
          className={`${TOOLBAR_BTN} border-sdc-border bg-white text-sdc-navy hover:bg-sdc-blue-light disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {busy ? "Unlocking…" : "Unlock"}
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
        onClick={doLock}
        disabled={busy}
        className={`${TOOLBAR_BTN} border-sdc-border bg-white text-sdc-gray-600 hover:bg-sdc-blue-light disabled:opacity-50`}
        title="Lock this grid again — turns editing off and hides the PM, Manufacturing and Warranty sections"
      >
        <LockIcon />
        {busy ? "Locking…" : "Lock"}
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
