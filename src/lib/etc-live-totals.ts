"use client";

import { useSyncExternalStore } from "react";

// Live per-job ETC totals, published by the cells that own the numbers and read
// by everything downstream of them.
//
// ── The bug this exists for (2026-08-03) ────────────────────────────────────
// Every derived figure on the Monthly ETC page — the row's TOTAL (NEW ETC)
// block, the sticky grand-total row, Total ETC $, % Total, Standard Fees, Total
// Standard Fees — is summed on the SERVER from stored EtcEntry values. The
// section cells themselves recompute Hours Left / New ETC / Diff client-side as
// you type (EtcSectionCells), so a manager watched each cell update correctly
// while every total that summed those cells sat frozen at what the page loaded
// with, until a save round-trip.
//
// That is one root cause, not four: everything downstream reads a per-job
// (engineering, shop, parts) triple. So the triple is what goes live here, and
// the row totals, the footer and the Standard Sheet all read it.
//
// It matters most on this page rather than Projects: this is the grid Submit ETC
// freezes. A total that disagrees with the cells above it is exactly the number
// nobody should be signing off.
//
// ── Why a module-scope store ────────────────────────────────────────────────
// Same reasoning as etc-dirty-tracker.ts, which this is modelled on: the
// publishers are ~800 independent cell components and the subscribers are a
// handful of totals components with no ancestor in common short of the page.
// Threading this through context would re-render the entire grid on every
// keystroke — which is the cost the server-rendered cells were chosen to avoid.
//
// ── The one rule that makes this safe ───────────────────────────────────────
// Publishers send values they computed with the SAME functions the server uses
// (calcHoursLeft / suggestNewEtc / newEtcDiff in lib/etc.ts). This module only
// ADDS. It must never contain a formula of its own, or the live total and the
// figure Submit persists could drift — worse than a stale total.

export type LiveCell = {
  jobId: number;
  // Which of the two rollup blocks this section feeds.
  billingGroup: "Engineering" | "Shop";
  prior: number;
  worked: number;
  hoursLeft: number;
  // The New ETC that would be written right now: the manager's value if typed,
  // else the suggestion.
  effective: number;
  diff: number;
  // Has anyone actually planned this cell? A blank New ETC now counts as 0, so an
  // untouched cell contributes its whole Hours Left to `diff` — true, but not a
  // variance. The KPI strip splits the two so it never calls unplanned work
  // "under plan".
  decided: boolean;
};

export type JobTotals = {
  engineering: { prior: number; worked: number; hoursLeft: number; newEtc: number; diff: number; diffUnplanned: number };
  shop: { prior: number; worked: number; hoursLeft: number; newEtc: number; diff: number; diffUnplanned: number };
  // Parts Cost is dollars, not hours, and has one cell per job rather than one
  // per section — so it is published separately and carries no group.
  parts: { prior: number; spent: number; left: number; newEtc: number; diff: number } | null;
};

// Keyed by STRING, not entry id: a section a job was never quoted for has no
// EtcEntry yet but is still an editable cell (see EtcSectionCells), and it needs
// a stable key before the row it will create exists. Real cells use the entry id;
// not-yet-created ones use `<jobId>:<section>`.
const cells = new Map<string, LiveCell>();
const parts = new Map<number, NonNullable<JobTotals["parts"]>>(); // jobId -> parts cell
const listeners = new Set<() => void>();

// Bumped on every change; the snapshot below is keyed on it so
// useSyncExternalStore can tell "same data" from "recomputed".
let version = 0;

function emit() {
  version += 1;
  for (const l of listeners) l();
}

export function publishEtcCell(cellKey: string, cell: LiveCell): void {
  const prev = cells.get(cellKey);
  if (
    prev &&
    prev.jobId === cell.jobId &&
    prev.billingGroup === cell.billingGroup &&
    prev.prior === cell.prior &&
    prev.worked === cell.worked &&
    prev.hoursLeft === cell.hoursLeft &&
    prev.effective === cell.effective &&
    prev.diff === cell.diff &&
    prev.decided === cell.decided
  ) {
    return; // no-op republish (a re-render with the same value) must not notify
  }
  cells.set(cellKey, cell);
  emit();
}

export function forgetEtcCell(cellKey: string): void {
  if (cells.delete(cellKey)) emit();
}

export function publishPartsCell(jobId: number, cell: NonNullable<JobTotals["parts"]>): void {
  const prev = parts.get(jobId);
  if (prev && prev.prior === cell.prior && prev.spent === cell.spent && prev.left === cell.left && prev.newEtc === cell.newEtc && prev.diff === cell.diff) {
    return;
  }
  parts.set(jobId, cell);
  emit();
}

export function forgetPartsCell(jobId: number): void {
  if (parts.delete(jobId)) emit();
}

const EMPTY_GROUP = () => ({ prior: 0, worked: 0, hoursLeft: 0, newEtc: 0, diff: 0, diffUnplanned: 0 });

// Recomputed from scratch on demand rather than maintained incrementally: the
// grid is at most ~800 cells, summing them is microseconds, and an incremental
// accumulator is how a rounding error or a missed unmount becomes a total that
// slowly stops matching its column.
function computeTotals(): Map<number, JobTotals> {
  const byJob = new Map<number, JobTotals>();
  const ensure = (jobId: number) => {
    let t = byJob.get(jobId);
    if (!t) byJob.set(jobId, (t = { engineering: EMPTY_GROUP(), shop: EMPTY_GROUP(), parts: null }));
    return t;
  };
  for (const c of cells.values()) {
    const t = ensure(c.jobId);
    const g = c.billingGroup === "Engineering" ? t.engineering : t.shop;
    g.prior += c.prior;
    g.worked += c.worked;
    g.hoursLeft += c.hoursLeft;
    g.newEtc += c.effective;
    // Summed PER CELL, matching the server: the suggestion clamps at zero per
    // cell, and that clamp cannot be reproduced from the group's sums.
    g.diff += c.diff;
    if (!c.decided) g.diffUnplanned += c.diff;
  }
  for (const [jobId, p] of parts) ensure(jobId).parts = p;
  return byJob;
}

let cachedVersion = -1;
let cached: Map<number, JobTotals> = new Map();

function snapshot(): Map<number, JobTotals> {
  if (cachedVersion !== version) {
    cached = computeTotals();
    cachedVersion = version;
  }
  return cached;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// The server snapshot is what renders on the way in and after any save, so it is
// also the correct value before a single cell has mounted and published.
const SERVER_SNAPSHOT: Map<number, JobTotals> = new Map();

export function useEtcLiveTotals(): Map<number, JobTotals> {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER_SNAPSHOT);
}

// Non-hook read, for imperative repainting (see EtcLiveTotals.tsx).
export function readEtcLiveTotals(): Map<number, JobTotals> {
  return snapshot();
}

export function subscribeEtcLiveTotals(cb: () => void): () => void {
  return subscribe(cb);
}
