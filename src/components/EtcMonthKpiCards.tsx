"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { usd, hours as fmtHours } from "@/components/ui/format";
import { HoursDetailPanel } from "@/components/HoursDetailPanel";
import { UndefinedHoursPanel } from "@/components/UndefinedHoursPanel";
// The drill card's height ceiling and its one scrolling region (§49). The two panels
// below are hand-rolled rather than DrillPanel, so they read the same two classes the
// shared panel does — the alternative is four opinions about how tall a drill may be.
import { DRILL_BODY, DRILL_CAP } from "@/components/ui/Drill";
import { ETC_SECTIONS } from "@/lib/sections";
import { offGridBySection, sectionName, type OffGridJob } from "@/lib/off-grid-hours";
import type { EtcMonthKpis } from "@/lib/etc-month-kpis";
// The strip's CONTENT — which blocks exist, what each one says, which drill it opens —
// is a pure function of the reconciled figures (§37). See the header note there for why
// it is not inline JSX any more.
import {
  buildKpiBlocks,
  kpiDetailState,
  offGridTotalHours,
  KPI_GRID_CLASS,
  type DrillScope,
  type KpiBlock,
} from "@/lib/etc-kpi-strip";
import type { JobHoursDetail } from "@/lib/job-hours-detail";
import type { UnattributedDetail } from "@/lib/unattributed-hours";
import { loadUnattributedDetail } from "@/lib/unattributed-actions";
import { loadEtcMonthHoursDetail, loadPartsSpentDetail, loadJobPartsLines } from "@/lib/hours-detail-actions";
import type { PartsSpentDetail } from "@/lib/parts-spent";
import type { JobPartsCost } from "@/lib/sync-totaleto";
import { readKpiStripOpen, writeKpiStripOpen, subscribeKpiStrip } from "@/lib/kpi-strip-pref";
import { subscribeKpiDrillRequest, readKpiDrillRequest, serverKpiDrillRequest } from "@/lib/etc-drill-request";
// Newest-wins ordering and in-flight de-duplication for every drill fetch below
// (§32.2). Replaces four hand-rolled request-id refs that each got the ordering
// right and the DUPLICATION wrong — see the note on the fetch effects.
import { sequenced } from "@/lib/request-sequence";
import { useEtcLiveTotals } from "@/lib/etc-live-totals";
// varianceTooltip is no longer imported here: the Parts tooltip is built where the block
// is built (lib/etc-kpi-strip.ts), which is what stops this component from having an
// opinion about which figures the sentence should quote.
import { reconcileEtcKpis, rollupLiveTotals } from "@/lib/etc-kpi-live";
// A completed refresh publishes through this feed, which is how the drill caches below
// learn that their sources have moved — including when somebody else started it.
import { useRealtimeChanges } from "@/components/RealtimeProvider";
import { useValueFlash } from "@/components/useMotion";

// Section code -> billing group, so the drill can be narrowed to the card that
// opened it. Same mapping the grid's column bands and the KPI totals use, from
// the same source, so "Engineering" means the identical set of sections in the
// card, the grid and the drill.
const SECTION_GROUP = new Map(ETC_SECTIONS.map((s) => [s.code, s.billingGroup]));

// The formatters the blocks are built with. Module-level and frozen, so building the
// strip cannot depend on anything that changes per render.
const KPI_FORMAT = { hours: fmtHours, usd } as const;

// Re-exported so the page's existing `import type { OffGridJob }` keeps working; the
// type and the rollup both live in lib/off-grid-hours.ts now, where a plain test can
// reach them (this component imports a "use server" action, which one cannot).
export type { OffGridJob };

// KPI strip at the top of the Monthly ETC page: hours worked and variance for
// Engineering and Shop, parts money spent, and how many people booked time —
// with a drill-through to the punch detail behind the headcount.
//
// Every hours figure comes from the SAME EtcEntry rows the grid's grand-total row
// sums, with the same effective-New-ETC rule (see getEtcMonthKpis), so a card can
// never contradict the total at the bottom of the table. The people counts and
// the drill come from the punch-level rows, which is the same source those totals
// were built from.
//
// Diff keeps the grid's sign convention: Hours Left − New ETC, so POSITIVE means
// the New ETC is under what's left (green) and negative means over (red). Getting
// that backwards here while the grid had it right would be worse than not showing
// it at all.

export function EtcMonthKpiCards({
  month,
  kpis,
  detailJobIds,
  importIssues,
  offGridJobs,
}: {
  month: string;
  kpis: EtcMonthKpis;
  // The jobs the grid is rendering, so the drill can be scoped to the card that
  // opened it. IDs only, not the punch rows themselves (2026-08-04, performance
  // pass): the rows are fetched when a drill is opened, by lib/hours-detail-actions.
  // Shipping them with the page cost 1,092 rows and 46ms of database time on EVERY
  // render of the heaviest route in the app — background refreshes, filter changes
  // and colleagues' saves included — for a panel that starts closed. The
  // undefined-hours drill beside it already worked this way.
  detailJobIds: number[];
  // Time booked to something that isn't a job number. Passed in from the page,
  // which already loads it for the amber banner — one query, one number, so the
  // card and the banner cannot disagree.
  importIssues: { label: string; rows: number; hours: number }[];
  // Hours sitting in this month's EtcEntry rows against jobs the grid does not
  // render — jobs whose status moved off Active after the month was seeded. Same
  // data as the red banner above the grid; see where hiddenJobHours is built in
  // etc/page.tsx for why this is a business call rather than a bug to auto-fix.
  offGridJobs: OffGridJob[];
}) {
  // ── Live Diff (2026-08-03) ─────────────────────────────────────────────────
  //
  // Of everything on this strip, only the three Diffs depend on a cell anyone can
  // edit: Hours Worked, the people counts and Parts spent all come from booked
  // time and purchase data, so they are properties of the month, not of the draft
  // on screen. The Diffs are Hours Left − New ETC, and New ETC is exactly what a
  // manager is typing — so they were the one set of figures here that could sit
  // contradicting the grid three rows below them.
  //
  // Summed from the same published cells the grid's own totals use
  // (lib/etc-live-totals.ts), so a card cannot disagree with the total at the
  // bottom of the table — which is the property the comment above promises.
  //
  // Falls back to the server figure when nothing has published yet (the strip can
  // be open on a month whose grid rows haven't mounted), rather than showing a
  // confident zero.
  // ── ONE reconciled set of figures (§28, 2026-08-04) ────────────────────────
  //
  // This used to sum only the three DIFFS out of the live store and leave everything
  // else on the server's page-load values — including `newEtc`, which is what the
  // diffs are computed FROM. So a card could show a live variance beside a stale New
  // ETC, and the Parts tooltip printed both in one sentence: "Money Left (X) − New
  // ETC (Y)" where X − Y was not the number above it.
  //
  // Now the whole strip comes from lib/etc-kpi-live.ts, which is the single place
  // that says which fields are editable-derived (newEtc, diff, diffUnplanned) and
  // which are synced (worked, spent, people, prior, hoursLeft). There is no arithmetic
  // left in this component, so no card can pick a different vintage from its neighbour.
  //
  // `live` is the ONLY set of figures the summary blocks are built from (§37.3): every
  // block reads it through buildKpiBlocks, so there is no longer a per-card choice
  // between `live.x` and `kpis.x` to get wrong — which is how the Parts tooltip came to
  // quote a page-load operand beside a live variance.
  const live = reconcileEtcKpis(kpis, rollupLiveTotals(useEtcLiveTotals()));

  // Summed through the same helpers the summary blocks use (lib/etc-kpi-strip.ts), so a
  // block and the drill panel that opens from it cannot disagree about the figure
  // (§37.13 #6). Both are cheap reductions over data already in props.
  const offGridTotal = offGridTotalHours(offGridJobs);
  // "By job" is the default because the ACTION lives on the job — setting it back to
  // Active is what saves the hours. "By section" answers the other question: what kind
  // of work is about to be lost.
  const [offGridView, setOffGridView] = useState<"job" | "section">("job");
  const offGridSections = useMemo(() => offGridBySection(offGridJobs), [offGridJobs]);

  const [drill, setDrill] = useState<DrillScope | null>(null); // null = closed
  // The punch rows behind the Engineering / Shop / People cards, fetched on first
  // open rather than shipped with the page — see the `detailJobIds` note above.
  // Kept for the life of the component once loaded: the punches only change on a
  // sync, and re-fetching on every open would make the panel feel slow for no
  // fresher an answer. Exactly the treatment the unattributed drill already had.
  const [detail, setDetail] = useState<JobHoursDetail | null>(null);
  const [loadingDetail, startDetail] = useTransition();
  const [detailError, setDetailError] = useState<string | null>(null);
  // Whether the summary strip is showing. Read through useSyncExternalStore for the
  // same reason as the other client prefs: reading localStorage during render
  // hydrates differently from the server.
  const stripOpen = useSyncExternalStore(subscribeKpiStrip, readKpiStripOpen, () => true);
  // "2026-07" -> "JULY 2026" for the card header. Parsed as local parts rather than
  // `new Date("2026-07")`, which is parsed as UTC midnight and prints as the PREVIOUS
  // month for anybody west of Greenwich — this server is UTC-4, so every card would have
  // been titled a month early.
  const monthTitle = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
    .toLocaleString("en-US", { month: "long", year: "numeric" })
    .toUpperCase();
  const setStripOpen = writeKpiStripOpen;
  // The unattributed drill is fetched on click, not with the page: it re-parses
  // the hours export, which nobody should pay for unless they open it.
  const [unattributed, setUnattributed] = useState<UnattributedDetail | null>(null);
  // The Parts spent drill: same treatment as the two beside it — fetched when opened,
  // cached, and dropped when a refresh lands (see the invalidation effect below).
  const [parts, setParts] = useState<PartsSpentDetail | null>(null);
  const [loadingParts, startParts] = useTransition();
  const [partsError, setPartsError] = useState<string | null>(null);
  const [loadingUnattributed, startUnattributed] = useTransition();
  const [unattributedError, setUnattributedError] = useState<string | null>(null);

  // The drill shows ONLY the sections belonging to the card that opened it —
  // Engineering from the Engineering card, Shop from Shop. It used to hand the
  // panel every punch in the month regardless, so a drill "opened from Shop"
  // listed ME Gen and Software rows and totalled the whole month, which made the
  // card and its own detail disagree.
  //
  // Narrowed here rather than in the panel: the panel's section dropdown and its
  // footer total both read off `detail`, so filtering the data is what keeps the
  // dropdown offering only this group's sections and the total matching the card.
  const scopedDetail = useMemo<JobHoursDetail | null>(() => {
    if (!detail) return null;
    // Every remaining drill scope narrows to one section group — the unscoped "All"
    // People Booked drill retired with its block (§64).
    if (!drill) return detail;
    const rows = detail.rows.filter((r) => SECTION_GROUP.get(r.section) === drill);
    // Section totals recomputed from the kept rows, so the dropdown's per-section
    // figures still add up to the footer.
    const bySection = new Map<string, number>();
    for (const r of rows) bySection.set(r.section, (bySection.get(r.section) ?? 0) + r.hours);
    return {
      rows,
      total: rows.reduce((s, r) => s + r.hours, 0),
      sections: detail.sections.filter((s) => bySection.has(s.code)).map((s) => ({ ...s, hours: bySection.get(s.code)! })),
      truncated: detail.truncated,
    };
  }, [detail, drill]);

  // The card and its drill come from two different tables: the card sums
  // EtcEntry.hoursWorked (written by the hours sync), the drill sums the punch
  // rows in JobHoursDetail. They agree to within a couple of hours but not
  // exactly, because the two were last written at different times — measured
  // 2026-07-30, Engineering was 2086.54 on the card against 2078.52 in the
  // punches. Small, real, and guaranteed to look like a bug if left unexplained,
  // so say it out loud whenever the gap would be visible.
  const cardWorked = drill === "Engineering" ? kpis.engineering.worked : drill === "Shop" ? kpis.shop.worked : null;
  const gap = cardWorked == null || scopedDetail == null ? 0 : scopedDetail.total - cardWorked;
  const scopeNote =
    Math.abs(gap) >= 1 && cardWorked != null && scopedDetail != null
      ? `The card reads ${fmtHours(cardWorked)} — these punch rows total ${fmtHours(scopedDetail.total)}. ` +
        `The card comes from the ETC grid's Hours Worked; these rows are the Paylocity punches behind it, and the two were last synced at different times.`
      : undefined;

  // Clicking a card's Detail link a second time CLOSES its panel — it's a
  // disclosure, and a control that opens something should put it away again
  // rather than leaving the only exit at the panel's far corner. Clicking a
  // DIFFERENT card still switches scope instead of closing, which is what
  // someone comparing Engineering against Shop is actually asking for.
  //
  // ── Opening a drill only OPENS it; the fetch is the effect's job ───────────
  //
  // This used to start the fetch itself, on the reasoning that "the click is the
  // event that means I want this data, and an effect would also fire on a
  // re-render, which is how duplicate requests start". The self-healing effects
  // below were added later for first-open and cache-invalidation, and once they
  // existed this handler became the duplicate it was written to prevent: the
  // click issued one request, then the re-render with `drill` set and `detail`
  // still null satisfied the effect's `if (detail) return` guard and issued a
  // SECOND identical one. Two requests for one click (§32.3 forbids exactly this).
  //
  // One fetch path now, and it is the effect. `sequenced` makes that safe on its
  // own terms rather than by argument: an identical request already in flight is
  // joined, not repeated.
  //
  // useCallback with no dependencies, so its identity never changes: it is passed to
  // every memoised MetricBlock, and a fresh function each render would defeat the
  // memoisation §37.4 and §37.11 ask for (only the affected block re-renders).
  const toggleDrill = useCallback((scope: DrillScope) => {
    setDrill((current) => (current === scope ? null : scope));
  }, []);

  // ── Opening a drill from outside this card (§44) ────────────────────────────
  //
  // The issues indicator in the page header replaced the full-width banners, and two of
  // those banners described figures that already have a drill here. Rather than
  // restating them in prose a second time, that indicator ASKS for the drill.
  //
  // Not a toggle: a request must always open. Someone clicking "Undefined hours" in the
  // issues list means "show me", never "hide it if it happens to be showing" — and it
  // opens the summary strip too, because a drill rendered inside a collapsed strip is a
  // click that appears to do nothing.
  const drillRequest = useSyncExternalStore(subscribeKpiDrillRequest, readKpiDrillRequest, serverKpiDrillRequest);
  const lastHandledRequest = useRef(0);
  useEffect(() => {
    if (!drillRequest || drillRequest.n === lastHandledRequest.current) return;
    lastHandledRequest.current = drillRequest.n;
    setDrill(drillRequest.scope);
    if (!readKpiStripOpen()) writeKpiStripOpen(true);
  }, [drillRequest]);

  // ── Retry, per KPI (§37.9) ──────────────────────────────────────────────────
  //
  // Drops the cache and the error for the ONE lane that failed, which is enough: the
  // effect that owns that lane sees its data missing while its drill is open and
  // refetches. Nothing else is touched, so a failed Parts fetch cannot clear the punch
  // detail somebody else is reading.
  //
  // Stable identity for the same reason as toggleDrill — hence the scope argument
  // rather than a read of the `drill` state.
  const retryDrill = useCallback((scope: DrillScope) => {
    if (scope === "Parts") {
      setParts(null);
      setPartsError(null);
    } else if (scope === "Unattributed") {
      setUnattributed(null);
      setUnattributedError(null);
    } else {
      setDetail(null);
      setDetailError(null);
    }
  }, []);

  // ── Drill caches are dropped when the data underneath them moves (§30) ─────
  //
  // Both drills cache for the life of the component, on the reasoning that their
  // sources "only change on a sync". Refresh Data IS a sync, and this component never
  // unmounts across one — router.refresh() preserves state deliberately — so the cards
  // updated from the fresh server props while their own detail panels kept serving
  // rows from before the refresh. A card and its drill-through disagreeing is exactly
  // what §28.15 forbids, and the drill is the thing people open to check the card.
  //
  // Keyed on the realtime change feed, which a completed refresh publishes (see
  // recordChanges in lib/refresh-service.ts), so this also covers a refresh started by
  // somebody else. Dropping the cache is enough for a closed drill; an OPEN one is
  // refetched below, because leaving it blank would read as the data having vanished.
  const changes = useRealtimeChanges();
  const drillChangeSeen = useRef(changes.length);
  useEffect(() => {
    if (changes.length === drillChangeSeen.current) return;
    drillChangeSeen.current = changes.length;
    setDetail(null);
    setUnattributed(null);
    setParts(null);
  }, [changes.length]);

  // ── Ordering and de-duplication now come from lib/request-sequence ─────────
  //
  // There were three request-id refs here (plus a fourth for the per-job parts
  // lines), each doing `const req = ++ref.current` and checking it again on the
  // way out. That is the right idea — it is what stops a response the user has
  // moved on from landing late — but four copies of it meant four chances to get
  // it subtly wrong, and none of them de-duplicated a request already in flight.
  //
  // `sequenced(lane, key, work)` is the one implementation: the lane is the thing
  // being kept current, the key is the question being asked, and a result comes
  // back `ok` only if it is still the newest answer for that lane. The trap the
  // old comment warned about still applies and is still avoided — the
  // transition's pending flag must never be an effect dependency, because
  // starting the transition flips it and re-runs the effect.

  // ── The second level of the parts drill ───────────────────────────────────
  //
  // Which job's purchase lines are expanded, and the lines themselves, cached per job
  // so collapsing and reopening a row is instant. Each job is a separate TotalETO
  // round trip, so they are fetched one at a time, on demand — never all 45 up front.
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [jobLines, setJobLines] = useState<Record<string, JobPartsCost>>({});
  const [loadingJobLines, startJobLines] = useTransition();
  const [jobLinesError, setJobLinesError] = useState<string | null>(null);

  function toggleJobLines(jobNumber: string) {
    if (openJob === jobNumber) {
      setOpenJob(null);
      return;
    }
    setOpenJob(jobNumber);
    setJobLinesError(null);
    if (jobLines[jobNumber]) return; // already fetched
    startJobLines(async () => {
      // Keyed on the job, so expanding a second row does not invalidate the first
      // — each row's lines are a separate answer that stays valid once fetched.
      const out = await sequenced(`parts-lines:${jobNumber}`, jobNumber, () => loadJobPartsLines(jobNumber));
      if (out.ok) setJobLines((m) => ({ ...m, [jobNumber]: out.value }));
      else if (out.reason === "error") {
        setJobLinesError(out.error instanceof Error ? out.error.message : "Could not load the purchase lines.");
      }
    });
  }
  useEffect(() => {
    if (drill !== "Parts" || parts) return;
    // No synchronous clear of the error here: setting state during an effect cascades a
    // render, and the branches below already replace it with whatever this attempt
    // produces.
    startParts(async () => {
      const out = await sequenced("kpi-parts", month, () => loadPartsSpentDetail(month, detailJobIds));
      if (out.ok) setParts(out.value);
      else if (out.reason === "error") {
        setPartsError(out.error instanceof Error ? out.error.message : "Could not load the parts detail.");
      }
    });
    // detailJobIds is a new array each render; its CONTENT only moves with the month or
    // the Billable filter, both of which re-render the page and null this cache anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill, parts, month]);

  // Self-healing refetch: whenever a drill is open and its data is missing — first
  // open, or the invalidation above — fetch it. Guarded on the loading flag so a
  // re-render cannot start a second request, which is the duplicate-call hazard the
  // click-driven fetch above was written to avoid.
  useEffect(() => {
    // Same shape as the Parts effect above, and the same trap avoided: the transition's
    // pending flag must not be a dependency, or starting the request re-runs the effect
    // and cancels it.
    if (drill !== "Unattributed" || unattributed) return;
    startUnattributed(async () => {
      const out = await sequenced("kpi-unattributed", month, () => loadUnattributedDetail(month));
      if (out.ok) setUnattributed(out.value);
      else if (out.reason === "error") {
        setUnattributedError(out.error instanceof Error ? out.error.message : "Could not read the hours export.");
      }
    });
  }, [drill, unattributed, month]);

  useEffect(() => {
    if (drill === null || drill === "OffGrid" || drill === "Unattributed" || drill === "Parts") return;
    if (detail) return;
    startDetail(async () => {
      // Keyed on the month alone: the punch detail is the same answer whichever of
      // the Engineering / Shop / All cards opened it (the panel narrows it
      // client-side), so switching cards must not refetch — and with a shared key
      // it cannot, because the second open joins the first request.
      const out = await sequenced("kpi-detail", month, () => loadEtcMonthHoursDetail(month, detailJobIds));
      if (out.ok) setDetail(out.value);
      else if (out.reason === "error") {
        setDetailError(out.error instanceof Error ? out.error.message : "Could not load the punch detail.");
      }
    });
    // detailJobIds is a fresh array every render; its CONTENT is what matters, and it
    // only changes with the month or the Billable filter — both of which re-render the
    // page and null the cache anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill, detail, loadingDetail, month]);

  // ── The blocks (§37.1) ──────────────────────────────────────────────────────
  //
  // Six blocks' worth of labels, values, statuses and tones, from the reconciled
  // figures. Deliberately NOT memoised: `live` is a fresh object whenever a cell
  // publishes (that is what makes the strip live), so a useMemo keyed on it would
  // recompute every time anyway while implying it did not. What actually keeps the work
  // down is MetricBlock being memo'd on primitives — building six small objects costs
  // nothing, re-rendering six subtrees on every keystroke was the cost worth removing.
  const blocks = buildKpiBlocks({ kpis: live, importIssues, offGridJobs }, KPI_FORMAT);

  // The three fetch lanes behind the six blocks, in the shape kpiDetailState reads
  // (§37.9). Which block shows an updating or failed marker is decided there, so the
  // property that matters — a slow or failed KPI leaves the other five alone — is a test
  // rather than a chain of ternaries nobody can check.
  const lanes = {
    punches: { loading: loadingDetail, error: detailError, loaded: detail != null },
    parts: { loading: loadingParts, error: partsError, loaded: parts != null },
    undefinedHours: { loading: loadingUnattributed, error: unattributedError, loaded: unattributed != null },
  };

  return (
    <div className="mb-4">
      {/* Collapsible, and remembered. Six boxes three lines tall pushed the grid —
          the thing people came for — below the fold on a laptop. Compact by
          default now, and hideable outright for anyone who never wants them. */}
      {/* Collapsed, the toggle has no card to sit in, so it keeps its own row. Open, it
          moves INTO the card header beside the month (see below) — which is where the
          stacked layout wants it: a floating "Hide summary" above a bordered card reads
          as belonging to the page rather than to the thing it hides. */}
      <div className={`mb-1.5 flex items-center justify-end ${stripOpen ? "hidden" : ""}`}>
        <button
          type="button"
          onClick={() => setStripOpen(!stripOpen)}
          aria-expanded={stripOpen}
          // Right-aligned in a fixed slot: "Hide summary" and "Show summary" are
          // different widths, and without the reservation the control walked left and
          // right as it was used (§36.14: "avoid replacing text with differently sized
          // content").
          className="motion-interactive min-w-[6.5rem] text-right text-label font-medium text-sdc-muted underline decoration-dotted underline-offset-2 hover:text-sdc-navy"
        >
          {stripOpen ? "Hide summary" : "Show summary"}
        </button>
      </div>
      {/* ── ONE summary card (§37.1) ─────────────────────────────────────────
          Six separate bordered cards became one: one outer border, one background,
          one shadow, and the metric blocks inside separated by hairline dividers
          rather than by six more borders (§37.7).
          The dividers are the grid's `gap-px` showing this container's background
          through — see KPI_GRID_CLASS for why that beats a per-block border (it
          survives wrapping, which a left border does not).
          motion-fade on the CARD, not on the blocks: revealing the summary is one
          deliberate action, so it is one transition. Animating each block separately
          would stagger six things the user asked for at once (§36.1).
          Labelled, so a screen reader announces what the region is before reading six
          figures out of it (§37.10). */}
      {/* ── Card and drill SIDE BY SIDE (2026-08-05, by request) ────────────
          The drill used to render BELOW the card, which pushed the grid down by the
          height of a whole panel every time somebody looked at a figure — the same
          complaint the banners caused, arriving by a different route. */}
      {/* ── Two independent heights, aligned at the TOP (§49, by request) ────
          This briefly ran on flex's default `stretch` — "the two cards must line up at
          the top and at the bottom" — which is the same instruction read the other way,
          and it made the summary card the loser: stretch gives a card the ROW's height
          without giving it any more content, so five KPI rows sat above ~200px of empty
          grey whenever a drill was open beside them. A card cannot be equal-height with
          a table of forty-five jobs and still be a card.
          So `items-start`, each card its own height, and the drill takes a ceiling of its
          own instead (DRILL_CAP) — which is what stops "as tall as its content" from
          meaning "as tall as it likes".

          ── Wrapping, not a breakpoint ───────────────────────────────────────
          `flex-wrap` with a flex-basis on the drill column, rather than `xl:flex-row`.
          §26.2 is the reason: Tailwind's breakpoints measure the VIEWPORT and this row is
          not the viewport — it is inset by a sidebar that is ~276px expanded, so `xl`
          (1280px) fires on a card that is only ~1000px wide and the drill would be
          squeezed to ~490px on exactly the "normal desktop" width the requirement is
          about. Wrapping measures the actual box: the two sit side by side while both
          fit, and the drill drops to its own full-width line when they do not. Browser
          zoom needs no separate handling for the same reason. */}
      <div className="flex flex-wrap items-start gap-3">
      {stripOpen && (
      <section
        aria-label={`${month} summary`}
        // @container: the block layout inside responds to THIS card's width rather than
        // the viewport's — see KPI_GRID_CLASS for why the viewport was the wrong box.
        // ── The card no longer spans the page (2026-08-05, by request) ──────
        //
        // Full width was right when this was six blocks in a row; stacked, it left a
        // label at the far left and its figure ~1,200px away at the far right, which is
        // a long way to travel to read one line. Capped at 34rem, which fits the widest
        // label and the widest figure with room to spare, and the space it gives back is
        // exactly where the drill now opens.
        //
        // shrink-0 so a wide drill table beside it cannot squeeze the card; the drill
        // column takes the pressure instead (it has min-w-0 and scrolls).
        className="@container motion-fade w-full max-w-[34rem] shrink-0 overflow-hidden rounded-xl border border-sdc-border bg-sdc-border-soft shadow-sm"
      >
      {/* The card's own header: which month these figures are for, and the control that
          puts them away. The month was previously nowhere on the card — the strip sat
          under a month picker and inherited its meaning from position alone, which is
          fine until somebody screenshots it. */}
      <div className="flex items-baseline justify-between gap-3 border-b border-sdc-border bg-white px-3 py-2">
        <h2 className="text-label font-semibold uppercase tracking-wide text-sdc-muted">{monthTitle}</h2>
        <button
          type="button"
          onClick={() => setStripOpen(false)}
          aria-expanded
          className="motion-interactive shrink-0 text-label font-medium text-sdc-muted underline decoration-dotted underline-offset-2 hover:text-sdc-navy"
        >
          Hide summary
        </button>
      </div>
      <div className={KPI_GRID_CLASS}>
        {/* Every block, from the one place that decides what the blocks are. The
            labels, tones, drill scopes and the conditional off-grid block all live in
            lib/etc-kpi-strip.ts — see its header for why the six hand-written cards
            that used to sit here became data.
            Keyed on the block's own id, not the index: `id` is stable across renders
            and across the off-grid block appearing or disappearing, so React updates a
            block in place rather than remounting the ones after it (§37.11). */}
        {blocks.map((block) => (
          <MetricBlock
            key={block.id}
            {...block}
            drillOpen={block.drill != null && drill === block.drill}
            detailState={kpiDetailState(block.drill, drill, lanes)}
            onDrill={toggleDrill}
            onRetry={retryDrill}
          />
        ))}
      </div>
      </section>
      )}
      {/* The drill column. min-w-0 is load-bearing: without it a flex child refuses to
          shrink below its content, and one wide punch table would push the card off the
          left edge instead of scrolling inside its own container. */}
      {/* `basis-[28rem]` is what decides side-by-side against stacked, and it is a
          BASIS rather than a min-width on purpose: the basis is the hypothetical size the
          wrap decision is made on, so the drill drops to its own line once the summary
          card no longer leaves it 28rem — but a min-width would also refuse to shrink
          after wrapping, and on a genuinely narrow window that is horizontal page scroll
          rather than a stacked layout.
          No `[&>*]:h-full` any more (§49): that existed only to push the drill panel out
          to the equal height stretch had given this column, and with `items-start` above
          there is no row height to fill. It is what made a capped, internally scrolling
          drill impossible — h-full overrode the ceiling with the row's height.

          Rendered only when a drill is OPEN, which it did not need to be while it was
          `flex-1`: an empty column simply took the slack. With a flex-basis it is 28rem
          of hypothetical width, so on a narrower row an EMPTY column wrapped to a second
          line and left a 12px row gap under the card — a phantom shift with nothing in
          it, on a layout whose whole job is not to shift (§49 acceptance 7). */}
      {drill != null && (
      <div className="min-w-0 shrink grow basis-[28rem]">
      {drill === "Parts" ? (
        // ── Where the parts money went, by job ──────────────────────────────
        //
        // Every figure here comes from the same EtcEntry rows and the same functions
        // (effectiveNewEtc / newEtcDiff / calcHoursLeft) that getEtcMonthKpis uses, so
        // the footer IS the card rather than a second opinion about it (§28.15).
        // Capped, with the table as its one scrolling region (§49). The heading and the
        // instruction above it stay put; forty-five job rows scroll underneath them.
        <div className={`motion-panel flex ${DRILL_CAP} flex-col rounded-xl border border-sdc-border bg-white p-4 shadow-sm`}>
          <p className="mb-1 text-xs font-semibold text-sdc-navy">Parts spent — {month}, by job</p>
          <p className="mb-3 text-xs leading-relaxed font-medium text-sdc-gray-700">
            Money invoiced against each job this month, biggest first. Click a row to see the purchase-order lines behind it.
          </p>

          {partsError && <p className="text-note font-medium text-sdc-red-text">{partsError}</p>}
          {!partsError && loadingParts && !parts && <p className="text-note text-sdc-gray-600">Loading the parts detail…</p>}
          {!partsError && parts && parts.rows.length === 0 && (
            <p className="text-note text-sdc-gray-600">No job in this month has a parts budget or any parts spend.</p>
          )}

          {!partsError && parts && parts.rows.length > 0 && (
            // Was a flat 420px; now it takes whatever the card's ceiling leaves it (§49),
            // so a tall window shows more rows and a short one shows fewer, rather than
            // both showing 420px and the tall one wasting the rest.
            <div className={DRILL_BODY}>
              {/* Two columns only, by request: the question this panel answers is
                  "where did the money go", and budget/plan columns were answering a
                  different one that the grid below already covers. */}
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b-2 border-sdc-border text-sdc-navy">
                    <th className="px-2 py-2 text-left font-bold">Job</th>
                    <th className="px-2 py-2 text-right font-bold">Money spent</th>
                  </tr>
                </thead>
                <tbody>
                  {parts.rows.map((r) => {
                    const open = openJob === r.jobId;
                    const lines = jobLines[r.jobId];
                    return (
                      <Fragment key={r.id}>
                        <tr
                          className={`cursor-pointer border-b border-sdc-border-soft/60 hover:bg-sdc-blue-light/40 ${open ? "bg-sdc-blue-light/50" : ""}`}
                          onClick={() => toggleJobLines(r.jobId)}
                        >
                          <td className="px-2 py-2 text-left">
                            <span className="mr-1.5 inline-block w-2 text-sdc-navy">{open ? "▾" : "▸"}</span>
                            <span className="font-mono font-bold text-sdc-navy">{r.jobId}</span>
                            <span className="ml-2 font-semibold text-sdc-navy">{r.jobName}</span>
                          </td>
                          <td className="px-2 py-2 text-right font-bold tabular-nums text-sdc-navy">{usd(r.spent)}</td>
                        </tr>
                        {open && (
                          <tr className="border-b border-sdc-border">
                            <td colSpan={2} className="bg-sdc-gray-50 px-3 py-2.5">
                              {jobLinesError && <p className="text-xs font-semibold text-sdc-red-text">{jobLinesError}</p>}
                              {!jobLinesError && !lines && loadingJobLines && (
                                <p className="text-xs font-medium text-sdc-gray-700">Loading purchase lines for {r.jobId}…</p>
                              )}
                              {!jobLinesError && lines && lines.lines.length === 0 && (
                                <p className="text-xs font-medium text-sdc-gray-700">
                                  TotalETO holds no purchase-order lines for job {r.jobId}.
                                </p>
                              )}
                              {!jobLinesError && lines && lines.lines.length > 0 && (
                                <>
                                  {/* Says outright that these are the job's WHOLE purchase
                                      history, not the month's — a part invoiced in July can
                                      have been ordered in March, and the PO is what is being
                                      examined. Without this the two totals look wrong. */}
                                  <p className="mb-2 text-note leading-relaxed font-medium text-sdc-gray-700">
                                    All purchase lines for job {r.jobId} — <strong>{usd(lines.purchased)} purchased</strong>,{" "}
                                    {usd(lines.paid)} invoiced, {usd(lines.leftToPay)}{" "}
                                    left to pay. This is the job&apos;s whole history,
                                    not just {month}, so it will not equal the {usd(r.spent)} above.
                                  </p>
                                  <div className="styled-scrollbar max-h-64 overflow-auto rounded border border-sdc-border bg-white">
                                    <table className="w-full border-collapse text-note">
                                      <thead className="sticky top-0 bg-sdc-gray-50">
                                        <tr className="border-b border-sdc-border text-sdc-navy">
                                          <th className="px-2 py-1.5 text-left font-bold">PO</th>
                                          {/* getJobPartsCost already sorts newest purchase first, so this
                                              column is also the order the rows are in. */}
                                          <th className="px-2 py-1.5 text-left font-bold whitespace-nowrap">Purchased on</th>
                                          <th className="px-2 py-1.5 text-left font-bold">Supplier</th>
                                          <th className="px-2 py-1.5 text-left font-bold">Part</th>
                                          <th className="px-2 py-1.5 text-right font-bold">Qty</th>
                                          <th className="px-2 py-1.5 text-right font-bold">Unit</th>
                                          <th className="px-2 py-1.5 text-right font-bold">Purchased</th>
                                          <th className="px-2 py-1.5 text-right font-bold">Invoiced</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {lines.lines.map((l, i) => (
                                          <tr key={i} className="border-b border-sdc-border-soft/50" title={l.description ?? undefined}>
                                            <td className="px-2 py-1.5 text-left font-mono font-semibold text-sdc-navy">{l.poNumber ?? "—"}</td>
                                            {/* The PO date, not the invoiced date — "when did we buy
                                                this" is the question a purchase line answers. The
                                                invoiced date is what the month's figure is windowed
                                                on, which is why the two need not agree; the note
                                                above the table says so. */}
                                            <td className="px-2 py-1.5 text-left font-medium whitespace-nowrap text-sdc-navy">
                                              {l.purchaseDate ?? "—"}
                                            </td>
                                            <td className="max-w-[150px] truncate px-2 py-1.5 text-left font-medium text-sdc-navy">
                                              {l.supplier ?? "—"}
                                            </td>
                                            <td className="max-w-[220px] truncate px-2 py-1.5 text-left font-medium text-sdc-navy">
                                              {l.partNumber ? `${l.partNumber} — ` : ""}
                                              {l.description ?? "—"}
                                            </td>
                                            <td className="px-2 py-1.5 text-right font-medium tabular-nums text-sdc-navy">{l.quantity}</td>
                                            <td className="px-2 py-1.5 text-right font-medium tabular-nums text-sdc-navy">{usd(l.unitPrice)}</td>
                                            <td className="px-2 py-1.5 text-right font-bold tabular-nums text-sdc-navy">{usd(l.totalPrice)}</td>
                                            <td className="px-2 py-1.5 text-right font-medium tabular-nums text-sdc-gray-700">
                                              {usd(l.invoicedAmount)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-sdc-border bg-sdc-gray-50 font-bold text-sdc-navy">
                    <td className="px-2 py-2 text-left">{parts.rows.length} jobs</td>
                    <td className="px-2 py-2 text-right tabular-nums">{usd(parts.totals.spent)}</td>
                  </tr>
                </tfoot>
              </table>
              {/* Says so out loud when the footer and the card differ, rather than
                  leaving somebody to spot it. They can legitimately differ by the
                  quiet jobs excluded above — nothing else should move them apart. */}
              {Math.abs(parts.totals.spent - live.parts.spent) >= 0.5 && (
                <p className="mt-2 rounded border border-sdc-yellow bg-sdc-yellow-bg/60 px-2 py-1.5 text-label leading-relaxed text-sdc-gray-600">
                  This totals {usd(parts.totals.spent)} against the card&apos;s {usd(live.parts.spent)}. Both read the same month; if the gap
                  is not the excluded jobs above, run &ldquo;Refresh Data&rdquo; and check again.
                </p>
              )}
            </div>
          )}
        </div>
      ) : drill === "OffGrid" ? (
        // Capped, with the table as its one scrolling region (§49). The two explanatory
        // paragraphs and the Split by toggle stay put — this is the one figure on the
        // strip with an action attached, and scrolling the "what to do about it" out of
        // view to read the rows would defeat the panel.
        <div className={`motion-panel flex ${DRILL_CAP} flex-col rounded-xl border border-sdc-red-border bg-white p-4 shadow-sm`}>
          <p className="mb-1 text-xs font-semibold text-sdc-navy">
            {/* The trailing space is explicit. It reads as an ordinary space between an
                expression and the text after it, and on one line JSX does preserve that
                — but it rendered as "5 jobsthe grid isn't listing" in a screenshot, and
                a separator that depends on JSX whitespace rules is not worth defending.
                {" "} cannot be collapsed by a formatter re-wrapping the line either. */}
            {fmtHours(offGridTotal)} hours on {offGridJobs.length} {offGridJobs.length === 1 ? "job" : "jobs"}{" "}
            the grid isn&apos;t listing
          </p>
          {/* The WHY and the WHAT-NOW, not just the number. This is the one figure
              on the strip with a deadline attached, and a drill that only restated
              the total would send someone hunting for the explanation. */}
          <p className="mb-2 text-note leading-relaxed text-sdc-gray-600">
            The grid lists <strong>Active, billable</strong> jobs only, so anything else lands here — a job that moved status, one that is
            non-billable, one already Complete, or a <strong>HeadStart</strong> job (no PO, so never planned in an ETC month; listed always,
            even at 0 hours, so one that starts booking time is seen). Set a job back to Active and billable to bring it into the month, or
            accept the shortfall deliberately.
          </p>
          {/* Sourced from JobHoursDetail, not EtcEntry — see where hiddenJobEntries is
              built. Worth stating outright, because the previous version of this panel
              promised the opposite and was right to: it read rows that prune deletes. */}
          <p className="mb-3 text-note leading-relaxed text-sdc-gray-600">
            Counted from the <strong>punch records</strong>, so this figure stays visible and is not affected by Refresh Data or Submit ETC.
            It still reaches no total in the grid below until the job qualifies.
          </p>
          {/* Two readings of the same 181 hours. Both total identically — they have to,
              since the card above shows that figure too. */}
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-label font-medium text-sdc-muted">Split by</span>
            {(["job", "section"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setOffGridView(v)}
                aria-pressed={offGridView === v}
                title={
                  v === "job"
                    ? "One row per job — the job is where the fix is (set it back to Active)"
                    : "One row per section, summed across every off-grid job"
                }
                className={`h-6 rounded-md border px-2 text-label font-medium motion-interactive ${
                  offGridView === v
                    ? "border-sdc-blue bg-sdc-blue text-white"
                    : "border-sdc-border bg-white text-sdc-navy hover:bg-sdc-blue-light"
                }`}
              >
                {v === "job" ? "Job" : "Section"}
              </button>
            ))}
          </div>
          {/* Was a flat 18rem; now it takes whatever the card's ceiling leaves it (§49).
              The footnote below stays outside it, so it cannot be scrolled away. */}
          <div className={`${DRILL_BODY} rounded-lg border border-sdc-border`}>
            <table className="w-full border-collapse text-note">
              <thead className="sticky top-0 bg-sdc-gray-100">
                <tr className="text-left text-label font-semibold uppercase tracking-wide text-sdc-muted">
                  {offGridView === "job" ? (
                    <>
                      <th className="px-2 py-1.5">Job</th>
                      <th className="px-2 py-1.5">Status</th>
                      <th className="px-2 py-1.5">Sections</th>
                      <th className="px-2 py-1.5 text-right">Hours</th>
                    </>
                  ) : (
                    <>
                      <th className="px-2 py-1.5">Section</th>
                      <th className="px-2 py-1.5">Jobs</th>
                      <th className="px-2 py-1.5 text-right">Hours</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {offGridView === "job"
                  ? offGridJobs.map((j) => (
                      <tr key={j.jobId} className="border-t border-sdc-border-soft align-top">
                        <td className="px-2 py-1.5">
                          <span className="font-mono font-semibold text-sdc-blue-dark">{j.jobId}</span>
                          <span className="ml-1.5 text-sdc-gray-600">{j.jobName}</span>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-sdc-yellow-text">{j.status ?? "—"}</td>
                        {/* One section per LINE, named. It used to be a single
                            interpunct-joined string ("10-313 71 · 10-211 37 · …"),
                            which is unreadable past two sections and gave the codes no
                            names at all. */}
                        <td className="px-2 py-1.5 text-sdc-gray-600">
                          {/* A HeadStart job is listed even with nothing booked, so this
                              says so rather than leaving the cell blank and looking like
                              missing data. */}
                          {j.sections.length === 0 ? (
                            <span className="text-sdc-gray-400">No hours booked this month</span>
                          ) : (
                            // Name only — the code is dropped (2026-08-03, by request).
                            // It falls back to the code for anything the app does not
                            // model, so a row can never render as a bare number.
                            j.sections.map((s) => (
                              <span key={s.section} className="block whitespace-nowrap">
                                {sectionName(s.section) ?? s.section}
                                <span className="ml-1 font-semibold tabular-nums text-sdc-navy">{fmtHours(s.hours)}</span>
                              </span>
                            ))
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-sdc-navy">{fmtHours(j.hours)}</td>
                      </tr>
                    ))
                  : offGridSections.map((s) => (
                      <tr key={s.section} className="border-t border-sdc-border-soft align-top">
                        <td className="px-2 py-1.5 whitespace-nowrap text-sdc-navy">
                          {/* Name only, matching the by-job view. Falls back to the code
                              for a section the app does not model. */}
                          {s.name ?? s.section}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-sdc-gray-600">{s.jobIds.join(", ")}</td>
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-sdc-navy">{fmtHours(s.hours)}</td>
                      </tr>
                    ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-sdc-navy bg-sdc-gray-50 font-semibold">
                  <td className="px-2 py-1.5" colSpan={offGridView === "job" ? 3 : 2}>
                    Total
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-sdc-navy">{fmtHours(offGridTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {/* Parts Cost is excluded upstream: it stores DOLLARS in the same column
              these hours come from, so including it would put money in an hours
              total. Said here because a reader comparing this against the job's
              Parts row would otherwise think something was missing. */}
          <p className="mt-2 text-label text-sdc-gray-400">Hours only — Parts Cost is money and is not counted here.</p>
        </div>
      ) : drill === "Unattributed" ? (
        loadingUnattributed || (!unattributed && !unattributedError) ? (
          <p className="motion-panel rounded-xl border border-sdc-border bg-white p-4 text-xs text-sdc-muted shadow-sm">
            Reading the hours export…
          </p>
        ) : unattributedError ? (
          <p className="motion-panel rounded-xl border border-sdc-red-border bg-sdc-red-bg p-4 text-xs font-medium text-sdc-red-text shadow-sm">
            Could not load the undefined-hours detail — {unattributedError}
          </p>
        ) : (
          // Its own panel since 2026-08-05 (§42.27), not HoursDetailPanel. That one is
          // built for "who worked on this job" — a punch list grouped by
          // department/employee/section. These rows are FAULTS to be corrected, so the
          // panel leads with the reason breakdown and what to do about each, and states
          // its reconciliation against the KPI outright (§42.28).
          //
          // The `note` that used to be passed here explained that the card and the drill
          // might disagree, because they read two different sources. They no longer can:
          // both come from one pass over one import. See lib/unattributed-hours.ts.
          <UndefinedHoursPanel detail={unattributed!} month={month} onClose={() => setDrill(null)} />
        )
      ) : (
        drill &&
        // Three states now that the rows arrive on demand. The panel keeps its own
        // shape in all three so opening a drill never shifts the page under the
        // cursor: a one-line box while loading, the same box with the error, then
        // the table.
        (detailError ? (
          <p className="motion-panel rounded-xl border border-sdc-red-border bg-sdc-red-bg p-4 text-xs font-medium text-sdc-red-text shadow-sm">
            Could not load the punch detail — {detailError}{" "}
            <button
              type="button"
              // The same retry the block's own link offers (§37.9), which is now one
              // function rather than two. It used to close the drill and re-open it on a
              // setTimeout to force the fetch; clearing the lane is enough, because the
              // effect that owns it refetches whenever its drill is open and its data is
              // missing — and it keeps the panel on screen while it does.
              onClick={() => retryDrill(drill)}
              className="underline underline-offset-2 hover:no-underline"
            >
              Try again
            </button>
          </p>
        ) : scopedDetail == null ? (
          <p className="motion-panel rounded-xl border border-sdc-border bg-white p-4 text-xs text-sdc-muted shadow-sm">
            Loading the punch detail…
          </p>
        ) : (
          <HoursDetailPanel
            detail={scopedDetail}
            note={scopeNote}
            // Names the scope rather than where the click came from: "Engineering
            // hours" says what the table contains, where "(opened from
            // Engineering)" only said how you got here. This branch is reached only
            // for Engineering/Shop — Parts, Unattributed and OffGrid have their own
            // branches above, and the unscoped "All" (People Booked) retired with
            // its block (§64) — so the title is unconditional now.
            title={`${drill} hours — ${month}`}
            onClose={() => setDrill(null)}
          />
        ))
      )}
      </div>
      )}
      </div>
    </div>
  );
}

// ── One metric block inside the unified card (§37.1) ─────────────────────────
//
// The six separate Card / GroupCard / Variance / Unplanned components this replaced are
// gone, along with the two places a card decided its own content. A block renders a
// KpiBlock and nothing else: no arithmetic, no formatting, and no choice about which
// vintage of a figure to read (see lib/etc-kpi-strip.ts).
//
// ── Why memo, and why the props are flat (§37.4, §37.11) ────────────────────
//
// This component re-renders on EVERY keystroke anywhere in the grid — that is what
// makes the variances live. Before consolidation, six cards re-rendered with it each
// time, and after consolidation a single monolithic card would have been worse: one
// component whose whole subtree repaints because one of six figures moved is exactly
// what §37.11 forbids.
//
// memo + primitive props gives the opposite behaviour: React's shallow comparison sees
// that Engineering's label, value, status and tone are unchanged and skips it entirely,
// so typing in a Shop cell updates the Shop block alone. It only works because every
// field of KpiBlock is a primitive and both callbacks are stable — a nested `status`
// object or an inline arrow would compare unequal every render and silently restore the
// old all-six behaviour while looking optimised.
const MetricBlock = memo(function MetricBlock({
  id,
  label,
  value,
  hint,
  tone,
  toneLabel,
  drill,
  statusKind,
  statusArrow,
  statusText,
  statusSign,
  statusTitle,
  countLabel,
  drillOpen,
  detailState,
  onDrill,
  onRetry,
}: KpiBlock & {
  // Whether THIS block's panel is the one currently open, so its link can say so
  // instead of reading "Detail" while the detail is already on screen.
  drillOpen: boolean;
  // This block's own fetch state (§37.9). At most one block is ever non-idle, because
  // only an OPEN drill fetches anything — so a slow Parts query cannot put the other
  // five blocks into a loading state, and a failed one is named rather than hidden.
  detailState: "idle" | "loading" | "error";
  onDrill: (scope: DrillScope) => void;
  onRetry: (scope: DrillScope) => void;
}) {
  // ── The block updates; it does not re-arrive (§36.8) ───────────────────────
  //
  // Keyed on the FORMATTED value, not the raw number: the strip prints whole hours and
  // whole dollars, so a change of 0.4h that rounds to the same string is not a change
  // anybody can see, and flashing for it would be the block crying wolf.
  //
  // The highlight is an inset outline, which costs no layout at all, and the block's
  // element is never keyed or replaced — §36.8 forbids remounting a card to show that
  // its figure moved, and §37.4 forbids reloading the unified card to update one block.
  const changed = useValueFlash(value);
  const labelId = `kpi-${id}-label`;
  return (
    <div
      // No border and no shadow of its own: the unified card owns both, and the 1px
      // gaps between blocks are the dividers (§37.7 — "do not create nested heavy card
      // borders"). A tone tints the block's background instead of bordering it, which
      // reads as a section of one card rather than a card inside a card.
      //
      // min-h on the value line and the status line below, not on the block: the status
      // swaps between a variance, an unplanned figure and a neutral note as cells are
      // filled in, and without a floor the block changed height mid-typing and took the
      // whole card (and the grid below it) with it (§36.14, §37.7).
      // A ROW now, not a column (2026-08-05, by request). Label and status on the left,
      // figure and Detail right-aligned — so the figures line up down the card, which is
      // the one thing six side-by-side columns could never do.
      //
      // `items-center` with no reserved heights: a row is as tall as its tallest line and
      // every line here is a single line, so the status swapping between a variance and a
      // note cannot change the row's height. The three min-h floors the column layout
      // needed (§36.14) are gone with it.
      className={`motion-interactive flex min-w-0 items-center gap-3 px-3 py-2 ${changed ? "motion-flash" : ""} ${
        // A tone tints the row and adds a left accent — the accent is what makes a toned
        // row findable when the card is scanned quickly, and unlike a full border it
        // cannot double up against the gap-px dividers above and below.
        tone === "danger"
          ? "border-l-4 border-l-sdc-red bg-sdc-red-bg/70"
          : tone === "warn"
            ? "border-l-4 border-l-sdc-yellow bg-sdc-yellow-bg/70"
            : "border-l-4 border-l-transparent bg-white"
      }`}
      title={hint ?? undefined}
      // A group per KPI, named by its own label, so a screen reader announces
      // "Engineering hours" before the figure and its status rather than reading six
      // numbers out of one region (§37.10).
      role="group"
      aria-labelledby={labelId}
    >
      {/* The label gets the block's whole width. Sharing the top line with the Detail
          link left it 94px of 169px, which truncated "Engineering hours" and both toned
          labels — measured live, and §37.7 asks for every label to stay readable. The
          link moved down beside the status instead, where the two together still fit
          with room to spare. `truncate` stays as the graceful fallback if the strip is
          ever asked to hold more blocks than this. */}
      <p id={labelId} className="min-w-0 flex-1 truncate text-label font-semibold uppercase tracking-wide text-sdc-muted">
        {/* The tone, said in something other than colour (§37.10). The glyph is
            decorative — the sr-only words here and the status line below are what
            carry the meaning. */}
        {toneLabel && (
          <>
            <span aria-hidden="true" className={`mr-1 ${tone === "danger" ? "text-sdc-red-text" : "text-sdc-yellow-text"}`}>
              ⚠
            </span>
            <span className="sr-only">{toneLabel}: </span>
          </>
        )}
        {label}
      </p>
      {/* The value on its own line, so it can never compete with anything for width.
          Side by side with the status — as the separate cards had them — there is no room
          at six blocks across: "$1,432,857" beside "▼ $1,084,643 over" needs ~180px and
          gets ~155px on a 1280px screen, so one of the two had to clip, and §37.7/§37.8
          forbid clipping either. The reserved heights keep every block the same size
          whatever its figures do. */}
      {/* Status BEFORE the figure and to its left, so the column of figures on the right
          stays unbroken. It gets no reserved width: in a row there is space for it, and
          the whole reason the column layout hid things was that there wasn't.
          `flex-wrap` (§64): with the count label added, a narrow card wraps the status
          and count onto their own line rather than clipping either — the figure and
          Detail, ordered last, stay together on the line they wrap to.
          NOT `shrink-0` — that was measured to backfire here: it stops this group from
          ever being narrower than its own content, so the ROW overflows sideways
          instead of this group wrapping internally. The label's own `flex-1 truncate`
          already absorbs ordinary space pressure first (its content is prose, safe to
          ellipsise); this group only shrinks — and then wraps — once even a fully
          truncated label leaves no room, which is the narrow-screen case wrapping is
          for. */}
      <div className="flex min-w-0 flex-wrap items-baseline justify-end gap-3">
        <p
          className={`min-w-0 truncate text-note font-semibold tabular-nums ${
            statusKind === "unplanned"
              ? // Neutral amber rather than the green/red of a variance: unplanned work is
                // not good news or bad news, it is unfinished input. Painting it green
                // (which a positive Diff would have done) actively told managers the
                // opposite of what the number meant.
                "text-sdc-yellow-text"
              : statusKind === "text" || statusSign === 0
                ? "text-sdc-gray-400"
                : statusSign > 0
                  ? "text-sdc-green-text"
                  : "text-sdc-red-text"
          }`}
          title={statusTitle}
        >
          {/* Direction is in the words too ("under" / "over"), so the arrow is decorative
              and the meaning survives without colour or glyph (§37.10). */}
          {statusArrow && (
            <span aria-hidden="true" className="mr-0.5">
              {statusArrow}
            </span>
          )}
          {statusText}
        </p>
        {/* The headcount that used to be its own "People booked" block (§64) — between
            the status and the figure, exactly where the ticket asks for it. Muted like
            the status beside it (it's a fact, not a variance) and truncating rather
            than pushing the figure/Detail out of reserved width if it is ever long. */}
        {countLabel && <p className="min-w-0 shrink truncate text-note font-medium text-sdc-muted">{countLabel}</p>}
        {/* The figure. Right-aligned in a reserved width so every value on the card lines
            up on the same edge regardless of how long the label beside it is — the
            comparison this card exists for. Larger than it was, because a row has the
            room the columns did not. */}
        <p className="font-heading min-w-[5.5rem] text-right text-lg leading-tight font-bold tabular-nums text-sdc-navy">
          {value}
        </p>
        {drill != null && (
          <button
            type="button"
            // Retry replaces Detail only while THIS block's fetch has failed, and it
            // clears just this lane before the effect refetches — the drill stays open
            // throughout, so the panel below is never yanked out from under the click
            // (§37.9: "provide a retry option through the approved refresh or detail
            // workflow").
            onClick={() => (detailState === "error" ? onRetry(drill) : onDrill(drill))}
            aria-expanded={drillOpen}
            // The accessible name carries the KPI; the visible text stays "Detail".
            // Six buttons all named "Detail" is unusable from a screen reader's element
            // list, and §37.10 requires each Detail action to be associated with the
            // right KPI.
            aria-label={
              detailState === "error"
                ? `Retry loading the ${label} detail`
                : drillOpen
                  ? `Hide the ${label} detail`
                  : `Show the ${label} detail`
            }
            title={drillOpen ? "Hide the punch detail" : "Show every booked punch behind this figure"}
            // min-w, because "Detail", "Hide", "Loading…" and "Retry" are different
            // widths and this control sits at the block's right edge — swapping them
            // used to nudge the label beside it (§36.8, §36.14: reserve the space).
            className={`motion-interactive shrink-0 text-right text-label font-medium underline decoration-dotted underline-offset-2 min-w-[3.2rem] ${
              detailState === "error"
                ? "text-sdc-red-text"
                : drillOpen
                  ? "text-sdc-navy"
                  : "text-sdc-blue hover:text-sdc-blue-dark"
            }`}
          >
            {detailState === "error" ? "Retry" : detailState === "loading" ? "Loading…" : drillOpen ? "Hide" : "Detail"}
          </button>
        )}
      </div>
    </div>
  );
});
