"use server";

import { auth } from "@/lib/auth";
import { isValidMonth } from "@/lib/etc";
import { getEtcMonthHoursDetail, type JobHoursDetail } from "@/lib/job-hours-detail";

// The punch drill-through behind the Monthly ETC cards, fetched WHEN IT IS OPENED.
//
// ── Why this action exists (2026-08-04, performance pass) ────────────────────
//
// The ETC page used to load this with the page, every single time, for a panel that
// is CLOSED until somebody clicks "Detail". Measured on 2026-07 (49 jobs):
//
//     1,092 punch rows + the whole 120-row employee roster
//     46ms of database time — the single slowest query on the page
//     serialised into the RSC payload of every render
//
// "Every render" is the part that hurts. The route is re-rendered far more often
// than it is navigated to: a background refresh every 45s, a refetch on focus, one
// per filter change, and — until this same pass — one per realtime change event
// from any colleague. So the cost of a panel nobody had opened was being paid tens
// of times per session, on the heaviest page in the app.
//
// The unattributed-hours drill on the same strip already worked this way, with the
// reason stated in EtcMonthKpiCards: "fetched on click, not with the page —
// re-parsing it on every open would make the panel feel broken". This is the same
// judgement applied to the bigger of the two datasets.
//
// Behaviour is unchanged once open: same function, same scoping to the jobs the
// grid is rendering, same MAX_ROWS truncation flag.
export async function loadEtcMonthHoursDetail(month: string, jobIds: number[]): Promise<JobHoursDetail> {
  // Signed-in only. Every page is already behind auth (the (app) layout awaits it),
  // but a server action is a public endpoint of its own and has to say so itself.
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  if (!isValidMonth(month)) throw new Error(`Invalid month "${month}".`);
  // The caller passes the jobs the grid is rendering, so the drill matches the card
  // that opened it. Validated rather than trusted: these go straight into a WHERE
  // clause, and an unbounded list from a hand-posted request would be a way to ask
  // for the entire punch table. The cap is far above any real month (the ETC grid
  // renders ~50 jobs).
  const ids = jobIds.filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  if (ids.length === 0) return { rows: [], total: 0, sections: [], truncated: false };
  return getEtcMonthHoursDetail(month, ids);
}
