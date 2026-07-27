"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

// Shared unlock card for the password-gated tabs (Audit Log; the Standard Sheet
// gate can adopt it too). Adds a show/hide toggle, a submit pending state, and a
// hint — the gate forms were bare full-reload inputs with blind retries.

function UnlockButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 w-full rounded-md bg-sdc-navy px-3 py-2 text-sm font-medium text-white hover:bg-sdc-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Unlocking…" : "Unlock"}
    </button>
  );
}

export function PasswordGate({
  action,
  title,
  hint,
  wrongPassword,
}: {
  action: (formData: FormData) => Promise<void>;
  title: string;
  hint?: string;
  wrongPassword?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <form action={action} className="w-full max-w-sm rounded-lg border border-sdc-border bg-white p-6 shadow-sm">
        <h2 className="font-heading text-base font-semibold text-sdc-navy">{title}</h2>
        {hint && <p className="mt-1 text-sm text-sdc-gray-400">{hint}</p>}
        <div className="relative mt-4">
          <input
            type={show ? "text" : "password"}
            name="password"
            autoFocus
            placeholder="Password"
            className="w-full rounded-md border border-sdc-border px-3 py-2 pr-10 text-sm outline-none focus:border-sdc-blue"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-sdc-gray-400 hover:text-sdc-navy"
          >
            <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1.5 10 C4 5.5 7 3.5 10 3.5 C13 3.5 16 5.5 18.5 10 C16 14.5 13 16.5 10 16.5 C7 16.5 4 14.5 1.5 10 Z" strokeLinejoin="round" />
              <circle cx="10" cy="10" r="2.6" />
              {!show && <line x1="3" y1="3" x2="17" y2="17" strokeLinecap="round" />}
            </svg>
          </button>
        </div>
        {wrongPassword && <p className="mt-2 text-xs text-sdc-red-text">Incorrect password.</p>}
        <UnlockButton />
        <p className="mt-3 text-[11px] text-sdc-gray-400">Ask an admin if you don&apos;t have the password.</p>
      </form>
    </div>
  );
}
