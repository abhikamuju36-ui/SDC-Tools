import { SYNC_SOURCES, SYNC_INTERVAL_MS } from "@/lib/auto-sync";

// ── The refresh-status card, lifted out of page.tsx unchanged (2026-08-27) ───
//
// Moved here, not rewritten: the Dashboard redesign gave page.tsx a lot more to
// do, and this card is a self-contained answer to one question ("is what I am
// reading current?"). Every rule it had is intact — rendered from SYNC_SOURCES
// so a feed cannot appear here without being on the schedule; failures and
// stated WAITS coloured differently, because a red tick for data nobody has
// published teaches people to ignore red; the long per-source detail in the
// chip's tooltip; and still NO refresh button of its own, because the one
// control that starts a pass is "Refresh Data" in the sidebar, on every page.
//
// It sits at the BOTTOM of the redesigned page rather than above the fold. It is
// a caveat on the figures, not one of them.

// Relative "…ago" instead of a raw UTC timestamp — the old ISO string read as
// the viewer's local time and could misjudge freshness by hours.
function timeAgo(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDataThrough(d: Date | null | undefined) {
  return d ? `data thru ${d.toISOString().slice(0, 10)}` : null;
}

// "Aug 6, 2:04 PM" — compact enough that seven sources still fit on a handful of
// wrapped lines.
function formatClock(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export type FreshnessRow = { source: string; checkedAt: Date; refreshedThrough: Date | null; status: string | null };

export type LastRun = {
  completedAt: Date | null;
  userName: string | null;
  sourcesOk: number;
  sourcesFailed: number;
  durationMs: number | null;
};

export function RefreshScheduleCard({ freshnessRows, lastRun }: { freshnessRows: FreshnessRow[]; lastRun: LastRun | null }) {
  const freshnessBySource = new Map(freshnessRows.map((r) => [r.source, r]));
  const scheduledFeeds = SYNC_SOURCES.map((f) => {
    const row = freshnessBySource.get(f.source);
    return {
      ...f,
      checkedAt: row?.checkedAt ?? null,
      refreshedThrough: row?.refreshedThrough ?? null,
      // status is null when healthy. "Failed: …" means the last attempt broke and
      // this feed is aging; anything else is a stated WAIT — the source is fine
      // but upstream has not published the data yet (see recordSyncNote).
      failure: row?.status?.startsWith("Failed:") ? row.status : null,
      waiting: row?.status && !row.status.startsWith("Failed:") ? row.status : null,
      everRan: Boolean(row),
    };
  });
  const failingFeeds = scheduledFeeds.filter((f) => f.failure);

  return (
    // ── Deliberately the quietest container on the page (2026-08-28) ────────
    //
    // Operational metadata, not a business metric. It keeps every figure it had
    // — source freshness is the thing you come here for — but sits on the page
    // background rather than a white card, with tighter padding and a smaller
    // heading, so it reads as a footer to the dashboard instead of a sixth
    // peer section competing with Active Jobs.
    <div className="rounded-xl border border-sdc-border bg-sdc-gray-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-sdc-gray-600">Refresh Schedule</h3>
          <p className="mt-0.5 text-label leading-relaxed text-sdc-gray-400">
            All of these refresh together every {SYNC_INTERVAL_MS / 3_600_000 === 1 ? "hour" : `${SYNC_INTERVAL_MS / 3_600_000} hours`},
            in one pass — and “Refresh Data” in the sidebar runs that identical pass on demand. Historical months and app-owned
            figures (quoted hours, New ETC, notes) are deliberately excluded: they are never overwritten by a refresh.
          </p>
        </div>
        {lastRun && (
          <p className="shrink-0 text-label text-sdc-muted">
            Last refresh: {lastRun.completedAt ? timeAgo(lastRun.completedAt) : "still running"}
            {lastRun.userName ? ` — started by ${lastRun.userName}` : " — scheduled"}
            {lastRun.completedAt && ` · ${lastRun.sourcesOk}/${lastRun.sourcesOk + lastRun.sourcesFailed} sources ok`}
            {lastRun.sourcesFailed > 0 && <span className="font-semibold text-sdc-red-text"> · {lastRun.sourcesFailed} failed</span>}
            {lastRun.durationMs != null && ` · took ${Math.round(lastRun.durationMs / 100) / 10}s`}
          </p>
        )}
      </div>

      {failingFeeds.length > 0 && (
        <p className="mt-3 rounded-lg border border-sdc-red-border bg-sdc-red-bg px-3.5 py-2.5 text-xs font-medium text-sdc-red-text">
          {failingFeeds.length} feed{failingFeeds.length === 1 ? "" : "s"} failed on the last attempt and{" "}
          {failingFeeds.length === 1 ? "is" : "are"} now aging. Figures drawn from {failingFeeds.map((f) => f.label).join(", ")} may
          be out of date.
        </p>
      )}

      {/* One compact, wrapping status row — each source is a small chip
          ("Paylocity · Aug 6, 2:04 PM") and the chips wrap onto as many lines as
          the window needs, rather than each source claiming a three-line block.
          The full detail (data-through date, "open month only", the failure or
          waiting text) is in the chip's tooltip; the status dot and the warning
          glyph stay in the row itself, so a failure is visible without hovering. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1.5 text-xs">
        {scheduledFeeds.map((f, i) => {
          const tooltip = [
            f.everRan ? `Checked ${timeAgo(f.checkedAt!)}` : "Never run",
            formatDataThrough(f.refreshedThrough),
            f.monthScoped ? "Only the latest open ETC month — a submitted month is frozen and never touched" : null,
            f.failure,
            f.waiting,
          ]
            .filter(Boolean)
            .join("\n");
          return (
            <span key={f.source} className="flex items-center gap-1">
              {i > 0 && (
                <span aria-hidden className="mr-0.5 text-sdc-border">
                  |
                </span>
              )}
              <span title={tooltip} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 motion-interactive hover:bg-sdc-gray-50">
                <span
                  className={`h-1.75 w-1.75 shrink-0 rounded-full ${
                    f.failure ? "bg-sdc-red" : f.waiting ? "bg-sdc-yellow" : f.everRan ? "bg-sdc-green" : "bg-sdc-gray-400"
                  }`}
                />
                <span className="font-semibold text-sdc-navy">{f.label}</span>
                <span className="text-sdc-gray-400">· {f.everRan ? formatClock(f.checkedAt!) : "never run"}</span>
                {/* Not colour alone: the glyph says "look closer" even to someone
                    who can't tell the dot's red from its green. */}
                {f.failure && (
                  <span aria-hidden className="font-bold text-sdc-red-text">
                    ⚠
                  </span>
                )}
                {!f.failure && f.waiting && (
                  <span aria-hidden className="font-bold text-sdc-yellow-text">
                    ⚠
                  </span>
                )}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
