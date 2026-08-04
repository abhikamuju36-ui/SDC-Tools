"use client";

import { dismissAllChanges, dismissChange, useRealtimeChanges, useRealtimeStatus } from "@/components/RealtimeProvider";

// The change-notification banner (spec 5).
//
// Rules it exists to satisfy, and how:
//   • appears without a refresh          — fed by the SSE stream, not a poll
//   • shown to every connected user      — the hub broadcasts to all subscribers
//   • does not block normal app usage    — fixed, bottom-right, pointer-events
//                                          only on the cards themselves
//   • queued/grouped, not replaced       — a stack, newest first, capped at 4 on
//                                          screen with a count for the remainder
//   • distinguishes added/edited/removed — colour AND the wording of the line
//   • no sensitive or internal data      — it prints the user's display name, the
//                                          tab, the row, the column and the two
//                                          values. No ids, no SQL, no stack traces.

const TONE: Record<string, { dot: string; label: string }> = {
  added: { dot: "bg-sdc-green-text", label: "Added" },
  edited: { dot: "bg-sdc-blue", label: "Edited" },
  removed: { dot: "bg-sdc-red", label: "Removed" },
  recalculated: { dot: "bg-sdc-gray-400", label: "Recalculated" },
  rejected: { dot: "bg-sdc-red", label: "Refused" },
};

// Time as a person reads it. The event carries an ISO string from the server, so
// every viewer sees it in their own locale rather than the server's.
function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const VISIBLE = 4;

export function ChangeNotifications() {
  const changes = useRealtimeChanges();
  const status = useRealtimeStatus();

  // Offline is worth saying out loud: with the stream down, this tab is NOT
  // receiving other people's changes, and silence would otherwise read as "nothing
  // is happening". Autosave still works (it is an ordinary request) — the wording
  // is careful not to imply edits are being lost.
  const offline = status === "offline";
  if (changes.length === 0 && !offline) return null;

  const shown = changes.slice(0, VISIBLE);
  const hidden = changes.length - shown.length;

  return (
    <div
      // pointer-events-none on the container, auto on the cards: the banner sits
      // over the grid's bottom-right corner and must not swallow clicks meant for
      // the cells underneath it.
      className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-[320px] flex-col gap-2"
      aria-live="polite"
      aria-label="Recent changes by other users"
    >
      {offline && (
        <div className="pointer-events-auto rounded-lg border border-sdc-border bg-white px-3 py-2 text-[11px] text-sdc-gray-600 shadow-lg">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-sdc-red align-middle" />
          Live updates disconnected — reconnecting. Your edits are still being saved.
        </div>
      )}

      {shown.map((c) => {
        const tone = TONE[c.changeType] ?? TONE.edited;
        return (
          <div
            key={`${c.changeId}|${c.rowRef}|${c.columnName}`}
            className="pointer-events-auto rounded-lg border border-sdc-border bg-white px-3 py-2 shadow-lg"
          >
            <div className="flex items-start gap-2">
              <span className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] leading-snug text-sdc-navy">{c.message}</p>
                <p className="mt-0.5 text-[10px] text-sdc-gray-500">
                  {tone.label} · {clockTime(c.at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dismissChange(c.changeId, c.rowRef, c.columnName)}
                aria-label="Dismiss notification"
                className="shrink-0 rounded px-1 text-[13px] leading-none text-sdc-gray-400 hover:text-sdc-navy"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}

      {hidden > 0 && (
        <button
          type="button"
          onClick={dismissAllChanges}
          className="pointer-events-auto rounded-lg border border-sdc-border bg-sdc-gray-100 px-3 py-1.5 text-[10.5px] text-sdc-gray-600 shadow hover:bg-white"
        >
          + {hidden} more change{hidden === 1 ? "" : "s"} — clear all
        </button>
      )}
    </div>
  );
}
