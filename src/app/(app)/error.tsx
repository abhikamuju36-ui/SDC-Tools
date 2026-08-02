"use client";

// Group-level error boundary for every /(app) page (Dashboard, Jobs, Projects,
// Employees, Job Hours, Job Cost, Audit Log). Individual routes may still add
// their own error.tsx — e.g. /etc has a submission-specific one that keeps
// taking precedence for that segment. This is the graceful fallback for
// everything else, so a render/data-fetch failure (a brief Power BI or TotalETO
// hiccup, a DB blip) shows a recoverable card instead of a raw Next.js crash
// screen. reset() re-renders the segment (retries the server fetch) with no
// full reload; the sidebar stays because this renders inside the (app) layout.
import { useEffect } from "react";
import Link from "next/link";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the console; `digest` ties it to the server log line Next emits.
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-8">
      <div className="max-w-md rounded-xl border border-sdc-border bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="8" x2="12" y2="13" strokeLinecap="round" />
            <line x1="12" y1="16.5" x2="12" y2="16.5" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="mb-1 text-base font-semibold text-sdc-navy">Something went wrong on this page</h2>
        <p className="mb-4 text-sm text-sdc-gray-600">
          The page failed to load — often a brief hiccup talking to Power BI, TotalETO, or the database.
          Your data is safe; nothing was changed.
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={reset}
            className="rounded-lg bg-sdc-blue px-4 py-2 text-sm font-semibold text-white hover:bg-sdc-blue-dark"
          >
            Try again
          </button>
          {/* Link, not <a>: a bare anchor here does a full document reload,
              which throws away the router and every client-held preference on
              the way out of an error the user may well be able to recover from. */}
          <Link
            href="/"
            className="rounded-lg border border-sdc-border px-4 py-2 text-sm font-semibold text-sdc-navy hover:bg-sdc-blue-light"
          >
            Go to Dashboard
          </Link>
        </div>
        {error.digest && <p className="mt-3 text-[11px] text-sdc-gray-400">Reference: {error.digest}</p>}
      </div>
    </div>
  );
}
