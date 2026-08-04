"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { refreshApplicationData, refreshStatus } from "@/lib/refresh-actions";
import { useToast } from "@/components/ui/Toast";
import { flushEtcAutosave, isEtcDirty } from "@/lib/etc-dirty-tracker";

// ── The ONE refresh control (§25.2) ──────────────────────────────────────────
//
// Replaces: the Monthly ETC toolbar's "Sync Data ▾" dropdown (with its password field,
// its "Refresh Data (this month)" option and its "Sync History" option), the dashboard's
// "Refresh all now", and the dashboard's per-source "Run One Source" buttons. Five ways
// to refresh some of the data, none of which refreshed all of it, and one of which asked
// for a password to pull public upstream data.
//
// This runs the identical pass the hourly schedule runs (lib/refresh-service.ts →
// runAllSyncs), so a manual refresh and an automatic one can never leave the app in two
// different states — which was the actual problem, not the number of buttons.
//
// What it promises the user, in order (§25.7):
//   * responds to the click at once — "Refreshing application data…" on the button
//   * disables ONLY itself; the rest of the app stays usable and editable
//   * never fires twice from repeated clicks (in-flight guard here, DB lock server-side)
//   * on success, says so WITH THE TIME
//   * on partial failure, names the sources that failed and does NOT claim success
export function RefreshDataButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [pending, startTransition] = useTransition();
  // Somebody else's refresh, discovered on mount. Not polled: the realtime change event
  // a finished refresh publishes is what tells this tab it is over.
  const [othersRunningSince, setOthersRunningSince] = useState<string | null>(null);
  const { toast } = useToast();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // One read on mount, so a page opened during a refresh explains itself rather than
    // offering a click the lock will refuse.
    refreshStatus()
      .then((s) => {
        if (mounted.current) setOthersRunningSince(s.running ? s.since : null);
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, []);

  function run() {
    if (pending) return; // one click, one refresh
    startTransition(async () => {
      // Land any pending cell edit first. The refresh writes upstream figures into the
      // same tables the grid is editing, and a draft still on the 800ms debounce would
      // be saved AFTER the pass — harmless for the draft, but it would look like the
      // refresh had eaten it. Same courtesy the submission and the export do.
      if (isEtcDirty()) await flushEtcAutosave();

      const outcome = await refreshApplicationData();
      setOthersRunningSince(null);

      if (!outcome.ok) {
        if (outcome.reason === "locked") {
          const since = outcome.runningSince ? new Date(outcome.runningSince).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
          toast(
            `A refresh is already running${since ? ` (started ${since})` : ""} — it will finish for everyone. Nothing was started twice.`,
            "info",
          );
          setOthersRunningSince(outcome.runningSince);
          return;
        }
        toast(`Refresh failed — ${outcome.message}. Nothing was updated; the hourly schedule will try again.`, "error");
        return;
      }

      const at = new Date(outcome.completedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const started = outcome.seededMonth ? ` ${outcome.seededMonth} was started.` : "";
      if (outcome.status === "ok") {
        toast(`All application data was refreshed successfully at ${at}.${started}`, "success");
      } else {
        // Explicitly NOT a success: names what failed, says what did update, and says
        // what happens next (§25.7).
        toast(
          `Refreshed at ${at}, but ${outcome.failedLabels.length} source${outcome.failedLabels.length === 1 ? "" : "s"} failed: ` +
            `${outcome.failedLabels.join(", ")}. Everything else was updated; the hourly schedule will retry the rest.${started}`,
          "error",
        );
      }
    });
  }

  // ── The stage, not an indefinite message (§30) ────────────────────────────
  //
  // "Refreshing application data…" for the whole pass is what made a slow refresh
  // indistinguishable from a stuck one — the complaint this addresses. The service now
  // streams the stage it is on into the run record, and this polls it.
  //
  // Polled rather than pushed: the refresh holds a server action open for its whole
  // duration, so there is no render in between to carry the news. One cheap
  // single-row read a second, only while something is actually running, and it stops
  // the moment it is not — which is also what recovers a tab whose action promise
  // never resolves.
  const [progress, setProgress] = useState<{ stage: string | null; done: number; total: number } | null>(null);
  const running = pending || othersRunningSince != null;
  useEffect(() => {
    // No synchronous setState here: clearing on the way out happens in the cleanup
    // below, so nothing cascades a render during the effect itself.
    if (!running) return;
    let alive = true;
    const tick = async () => {
      // A ROUTE, not the refreshStatus server action. Next.js serializes server actions
      // from one client, so polls issued during the refresh queued behind it and did
      // not run until it was over — the button sat on the indefinite message for the
      // full 19 seconds and then jumped to done. Measured; see the route's own note.
      const s: { running: boolean; stage: string | null; done: number; total: number } | null = await fetch(
        "/api/refresh/status",
        { cache: "no-store" },
      )
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!alive || !s) return;
      setProgress(s.running ? { stage: s.stage, done: s.done, total: s.total } : null);
      // Somebody else's refresh finished while we were watching it — stop claiming it
      // is still going.
      if (!s.running) setOthersRunningSince(null);
    };
    const id = setInterval(tick, 1000);
    void tick();
    return () => {
      alive = false;
      clearInterval(id);
      // The pass this was reporting on is over (or this tab is unmounting): drop the
      // stage so a finished refresh cannot leave a stale one on the button.
      setProgress(null);
    };
  }, [running]);

  const stageLabel =
    progress?.stage != null
      ? `${progress.stage}… ${progress.total > 0 ? `(${Math.min(progress.done + 1, progress.total)} of ${progress.total})` : ""}`.trim()
      : null;
  const label = pending
    ? (stageLabel ?? "Refreshing application data…")
    : othersRunningSince
      ? (stageLabel ?? "Refresh running…")
      : "Refresh Data";
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={run}
      title={
        othersRunningSince
          ? "Another user's refresh is running — everyone gets the result."
          : "Pull the latest hours, parts costs, jobs and pools from every source, for the whole app. Runs the same pass as the hourly schedule."
      }
    >
      {compact && !pending ? "Refresh Data" : label}
    </button>
  );
}
