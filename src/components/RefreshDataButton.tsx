"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { refreshApplicationData, refreshStatus } from "@/lib/refresh-actions";
import { useToast } from "@/components/ui/Toast";
import { flushEtcAutosave, isEtcDirty } from "@/lib/etc-dirty-tracker";
import { usePendingWatchdog } from "@/components/usePendingWatchdog";

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
// ── The refresh gets its own watchdog ceiling (§36.9) ───────────────────────
//
// usePendingWatchdog's default is 15s, which is right for a navigation and wrong for
// this: a real refresh pass takes ~19s and can take minutes when TotalETO is slow, so
// the default would declare a healthy refresh dead every single time.
//
// It still needs A ceiling, because §36.9 asks that a loading animation stop on
// "success, failure, cancellation, or timeout" and this button has no cancellation and,
// until now, no timeout — a server action whose promise never resolved left the spinner
// turning and the control disabled until the browser was reloaded. Five minutes is
// longer than any measured pass and short enough that nobody sits through it twice.
const REFRESH_TIMEOUT_MS = 300_000;

export function RefreshDataButton({
  className,
  compact = false,
  dense = false,
}: {
  className?: string;
  compact?: boolean;
  // ── Who decides how wide the reservation is (§36.14) ─────────────────────
  //
  // The caller, because only the caller knows. This button appears in two places with
  // very different room: the sidebar footer, where it is `flex-1` beside Collapse and
  // measures 128px, and the Monthly ETC toolbar, where it is a full-size BUTTON_PRIMARY.
  //
  // `dense` was added after measuring the sidebar one in the running app during a real
  // refresh: at 128px, "Refresh running… 4/7" plus a spinner overflowed its slot and
  // `truncate` clipped it to "Refresh runni…". Reserving MORE would not have helped —
  // there is no more width to reserve. So a dense caller gets the short label and no
  // step counter, and progress is carried by the determinate bar and the tooltip, which
  // is exactly what §36.10 asks a narrow control to do.
  dense?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  // Bounds how long this button may CLAIM to be refreshing — see REFRESH_TIMEOUT_MS.
  // Declared here, above run(), because run() consults it before refusing a repeat click.
  const { busy: pendingBusy, timedOut: refreshTimedOut } = usePendingWatchdog(pending, {
    // The pass is legitimately slow, so there is no useful "this is taking longer than
    // expected" point short of the ceiling — the stage read-out below is what
    // distinguishes slow from stuck, and it is far better information than a phase change.
    slowAfterMs: REFRESH_TIMEOUT_MS,
    timeoutAfterMs: REFRESH_TIMEOUT_MS,
  });
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
    // One click, one refresh — unless the watchdog has already given up on this one, in
    // which case a click has to be able to try again (§36.9). Refusing it would be the
    // dead-control bug lib/pending-watchdog.ts exists to prevent. There is no risk of
    // two passes: the server holds a database lock and answers the second attempt with
    // `locked`, which this handler already reports as "nothing was started twice".
    if (pending && !refreshTimedOut) return;
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
  // The raw `pending`, deliberately, not the watchdog's bounded flag: the poll is the
  // thing that DISCOVERS a pass has finished, so it has to outlive the point at which
  // the button stops claiming to be busy. Distinct name from the `running` used for the
  // markup below, which is the claim rather than the request.
  const watching = pending || othersRunningSince != null;
  useEffect(() => {
    // No synchronous setState here: clearing on the way out happens in the cleanup
    // below, so nothing cascades a render during the effect itself.
    if (!watching) return;
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
  }, [watching]);

  // ── What it SAYS, versus how wide it is (§36.10, §36.14) ──────────────────
  //
  // The stage read-out used to be the button's whole label, which is why this control
  // was the app's worst layout shift: "Refresh Data" (≈78px) became "Parts costs from
  // TotalETO… (2 of 5)" (≈210px) and back again, on the one button that appears in the
  // sidebar on every page and in the Monthly ETC toolbar beside the month picker. In the
  // sidebar the text overflowed its own button; in the toolbar it shoved the Export menu
  // sideways for twenty seconds and back.
  //
  // §36.10 asks for a stable width AND for progress to be visible, so the two are
  // separated: the LABEL is short and stays short, and the progress is carried by the
  // step counter beside it and the determinate bar underneath. The stage NAME is not
  // lost — it is in the title, and in a live region for screen readers — and the counter
  // advancing is what §30 wanted from it anyway: proof this is slow, not stuck.
  const step =
    dense || progress == null || progress.total === 0
      ? null
      : `${Math.min(progress.done + 1, progress.total)}/${progress.total}`;
  // done/total, not done+1: the bar should show what is FINISHED, where the counter
  // beside it names the step in progress. Clamped because a source added mid-pass would
  // otherwise briefly overflow the track.
  const fraction = progress != null && progress.total > 0 ? Math.min(1, Math.max(0, progress.done / progress.total)) : 0;
  const running = pendingBusy || othersRunningSince != null;
  // ── ONE running label, not two (§36.14) ───────────────────────────────────
  //
  // It used to read "Refreshing application data…" for your own pass and "Refresh
  // running…" for somebody else's. Both are gone, and the second one is a deliberate
  // trade rather than an oversight: measured in the running app, "Refresh running… 12/12"
  // beside a spinner needs a 184px slot against "Refreshing… 12/12"'s 148px, so keeping
  // it would have meant a permanently 222px-wide button whose resting label is "Refresh
  // Data" — or a button that changed width, which is the thing this whole change is
  // fixing.
  //
  // Nothing is lost that matters: the tooltip and the sr-only live region below both
  // still say whose refresh it is, and the outcome is identical either way — the pass is
  // application-wide and everyone gets its result. The step counter, which is what §36.10
  // actually asks for, is what the width buys instead.
  const label = running ? "Refreshing…" : "Refresh Data";
  const stageTitle =
    progress?.stage != null
      ? `${progress.stage}${progress.total > 0 ? ` — step ${Math.min(progress.done + 1, progress.total)} of ${progress.total}` : ""}`
      : null;
  // Everything the visible label no longer has room to say, in one string used by BOTH
  // the tooltip and the screen-reader live region. Composed, not one-or-the-other: it
  // used to be `stageTitle ?? othersMessage`, so the stage silently displaced the
  // "somebody else started this" line the moment a stage was reported — and that is
  // exactly the fact the label gave up, so this is where it has to survive.
  const busyDescription =
    [
      othersRunningSince ? "Another user's refresh is running — everyone gets the result." : null,
      stageTitle,
    ]
      .filter(Boolean)
      .join(" ") || "Refreshing application data…";

  return (
    <button
      type="button"
      // `relative` and `overflow-hidden` so the progress bar can be pinned to the
      // button's own bottom edge: it is part of the control, not a second element in the
      // toolbar that would take space and move its neighbours.
      className={`relative overflow-hidden ${className ?? ""}`}
      // The watchdog's flag, not the raw `pending` — after REFRESH_TIMEOUT_MS the button
      // comes back so the click can be retried (§36.9).
      disabled={pendingBusy}
      aria-busy={running}
      onClick={run}
      title={
        running
          ? busyDescription
          : "Pull the latest hours, parts costs, jobs and pools from every source, for the whole app. Runs the same pass as the hourly schedule."
      }
    >
      {/* The reservation, per caller. MEASURED in the running app, not derived from a
          font metric: the first attempt reserved 9.5rem on the reasoning that it looked
          about right, and probing every state with the real font showed the widest one
          needing 148px — so the button would still have grown by 6px when the source
          count reached two digits. The values below are what each variant's widest state
          actually measures at the size that variant renders at:
            compact (collapsed rail, 26px of icons) — none. Anything reserved would push
              the Collapse button off the rail.
            dense (sidebar footer, 128px at 12px text) — 6.5rem ≈ 98px, which holds both
              "Refresh Data" and "Refreshing…" with the spinner.
            default (ETC toolbar, BUTTON_PRIMARY at 14px) — 10rem = 150px, sized for
              "Refreshing… 12/12" plus the spinner (148px measured, 2px of slack), so
              even a 12-source pass never widens the button or shoves the Export menu
              beside it.
          If the labels or the type size ever change, re-measure — do not adjust by eye. */}
      <span
        className={`inline-flex items-center justify-center gap-1.5 ${
          compact ? "" : dense ? "min-w-[6.5rem]" : "min-w-[10rem]"
        }`}
      >
        {running && (
          <svg viewBox="0 0 16 16" width="12" height="12" className="shrink-0 animate-spin" aria-hidden>
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
            <path d="M8 2 a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
        {/* min-w-0 + truncate, so a caller narrower than the label clips instead of
            overflowing — which is what the sidebar version did before. */}
        <span className="min-w-0 truncate">{compact && !running ? "Refresh Data" : label}</span>
        {/* tabular-nums so 9/12 and 10/12 are the same width: without it the counter
            re-centres the label every time a source completes. */}
        {step && <span className="shrink-0 tabular-nums opacity-80">{step}</span>}
      </span>

      {/* The subtle progress animation §36.10 asks for: a determinate hairline on the
          button's bottom edge. scaleX on a fixed-width element, so each tick costs a
          compositor transform rather than a layout pass (§36.15), and DETERMINATE
          because the server actually reports how many of how many sources are done —
          an indeterminate barber-pole would imply progress nobody had measured.
          Two siblings rather than a nested fill: nesting would multiply the track's
          opacity into the fill and flatten the contrast between them.
          Colours are `currentColor` so this works unchanged on the navy sidebar and on
          the blue primary button in the ETC toolbar. */}
      {running && (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]"
            style={{ backgroundColor: "currentColor", opacity: 0.18 }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-left"
            style={{
              backgroundColor: "currentColor",
              opacity: 0.75,
              transform: `scaleX(${fraction})`,
              // Inline so it needs no Tailwind arbitrary-value support. The
              // reduced-motion block in globals.css still wins over it — an `!important`
              // declaration in a stylesheet outranks a plain inline style.
              transitionProperty: "transform",
              transitionDuration: "var(--motion-panel)",
              transitionTimingFunction: "var(--ease-out)",
            }}
          />
        </>
      )}

      {/* The same words as the tooltip, for a screen reader, where the visual design
          carries progress as a bar and a counter. aria-live rather than relying on the
          title, because a title is not announced when it changes. */}
      <span className="sr-only" aria-live="polite">
        {running ? busyDescription : ""}
      </span>
    </button>
  );
}
