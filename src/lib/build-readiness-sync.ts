import "server-only";

// ── Build Readiness — live cross-job refresh + classification ───────────────
//
// This is NOT a second readiness formula. Every coverage/cost/release-status
// decision below reads a field job-bom-rules.ts's `makePart()` already
// computed (`.status`, `.source`, `.hold`, `.unitPrice`, `.costBasis`,
// `.release`) or calls one of its exported pure functions directly
// (`isUncoveredPart`, `buildableQtyFor`) — this file only WALKS the tree
// `getJobBom()` already built and classified, and persists the result. See
// job-bom-rules.ts's own header for why "no PO" isn't "missing", the BOM
// release-status rules, and the cost fallback chain.
//
// Performance context (why this is a throttled background pass, not something
// a page request can await): `getJobBom(jobId)` is a live call straight to
// TotalETO and is genuinely slow — 100+ seconds per job, measured (see
// with-timeout.ts's own header). There is no bulk variant. Across every active
// billable job that is minutes of work, so this runs in small concurrent
// batches (not all at once — dozens of simultaneous mssql connections against
// a shared production SQL Server is its own risk) and persists each job's
// result the moment it completes, so BuildReadinessRefreshMeta.jobsDone climbs
// continuously and the dashboard can render progressively instead of waiting
// for the whole pass.

import { prisma } from "@/lib/prisma";
import { getJobBom, type JobBom } from "@/lib/job-bom";
import {
  type BomNode,
  type BomPart,
  isUncoveredPart,
  buildableQtyFor,
} from "@/lib/job-bom-rules";
import { etcActiveJobFilter } from "@/lib/job-filters";
import type { BlockerEntry, BlockerReason, AssemblyDetail, JobDetail, UpcomingDeliveryEntry } from "@/lib/build-readiness-types";

const DAY = 86_400_000;

// Jobs processed at once during a bulk refresh — throttled well below the
// active-job count so this never opens dozens of simultaneous mssql
// connections against TotalETO. Not the 12s UPSTREAM_BUDGET_MS used for
// page-render bounding elsewhere (with-timeout.ts) — that budget would time
// out literally every job here, since a single getJobBom call alone can take
// 100+ seconds. This budget only needs to be longer than mssql's own
// `requestTimeout` (120s, job-bom.ts) so a genuinely stuck job fails on its
// own terms instead of hanging the batch forever.
const CONCURRENCY = 6;
const PER_JOB_TIMEOUT_MS = 130_000;

async function withJobTimeout<T>(label: string, ms: number, work: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not respond within ${ms}ms`)), ms);
      }),
    ]);
  } catch (err) {
    console.error(`[build-readiness] ${label} failed:`, err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// getJobBom() is deliberately fail-soft — "Kept defensive/fail-soft
// throughout: an unknown job or a query error yields an empty JobBom" (its
// own header) — so a genuinely-empty BOM and a transient connection failure
// are indistinguishable from outside it. That's fine for a single-job page
// render (a reload retries); it's a real risk here, where CONCURRENCY jobs
// each open their own full mssql connection pool at once and contention can
// make an otherwise-fine job's query fail for no reason related to that job
// (confirmed live: job 1142, which Job Hour Details -> Procurement shows with
// 151 parts, came back empty under 6-way concurrent load). One retry after a
// short backoff is cheap insurance against exactly that class of failure,
// without changing job-bom.ts's own fail-soft contract.
async function getJobBomWithRetry(jobId: string): Promise<JobBom | null> {
  const first = await withJobTimeout(`Build Readiness (job ${jobId})`, PER_JOB_TIMEOUT_MS, () => getJobBom(jobId));
  if (first && first.roots.length > 0) return first;
  await sleep(2000);
  const retry = await withJobTimeout(`Build Readiness (job ${jobId}, retry)`, PER_JOB_TIMEOUT_MS, () => getJobBom(jobId));
  return retry && retry.roots.length > 0 ? retry : first;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// ── Per-part blocker classification ──────────────────────────────────────────
//
// One reason per part (first match wins), so the Top Blockers breakdown is a
// clean partition rather than double-counted buckets. Every input here is a
// field job-bom-rules.ts's makePart() already computed — no coverage rule is
// re-derived.
function blockerReasonFor(p: BomPart, now: number): BlockerReason | null {
  if (p.status === "received") return null;
  if (p.hold) return "on_hold";
  if (isUncoveredPart(p)) return "no_po";
  const due = p.expectedDate || p.requiredDate;
  const dueMs = due ? new Date(due).getTime() : NaN;
  const isLate = Number.isFinite(dueMs) && dueMs < now;
  if (p.source === "stock" && p.receivedQty < p.qty) return "inventory_shortage";
  if (p.source === "po" && p.status === "ordered" && isLate) return "supplier_delay";
  if (isLate) return "past_due";
  if (!due) return "missing_expected_date";
  return null;
}

function partMaterialValue(p: BomPart): number {
  return p.unitPrice * p.qty;
}

// One assembly node's full detail row, plus the blocker/upcoming entries its
// own direct parts (and its own `self` line) contribute. Does NOT recurse
// into children — each child produces its own row via its own call.
function classifyNode(
  node: BomNode,
  keyPrefix: string,
  jobId: string,
  jobName: string,
  now: number,
): { detail: AssemblyDetail; blockers: BlockerEntry[]; upcoming: { part: BomPart; assemblyLabel: string }[]; blockedPartIds: Set<number> } {
  const ownParts: BomPart[] = node.self ? [node.self, ...node.parts] : node.parts;
  const blockers: BlockerEntry[] = [];
  const upcoming: { part: BomPart; assemblyLabel: string }[] = [];
  const blockedPartIds = new Set<number>();

  let missingParts = 0;
  let onOrderParts = 0;
  let pastDueParts = 0;
  let nextExpectedDelivery: string | null = null;

  for (const p of ownParts) {
    const reason = blockerReasonFor(p, now);
    if (reason) {
      blockedPartIds.add(p.id);
      blockers.push({
        reason,
        jobId,
        jobName,
        assemblyKey: node.key,
        assemblyLabel: node.label,
        partPn: p.pn,
        partDesc: p.desc,
        supplier: p.supplier,
        materialValue: partMaterialValue(p),
        daysLate: p.expectedDate ? Math.max(0, Math.round((now - new Date(p.expectedDate).getTime()) / DAY)) : null,
        expectedDate: p.expectedDate,
      });
      if (reason === "no_po") missingParts++;
      if (reason === "supplier_delay" || reason === "past_due") pastDueParts++;
    }
    if (p.status === "ordered") onOrderParts++;
    if (p.status !== "received" && p.expectedDate) {
      if (!nextExpectedDelivery || p.expectedDate < nextExpectedDelivery) nextExpectedDelivery = p.expectedDate;
      upcoming.push({ part: p, assemblyLabel: node.label });
    }

    // Best-effort "awaiting release" overlay — an assembly that IS itself a
    // buy/build unit (Assembly Only / Both) but whose own line is uncovered
    // or held. This is deliberately an OVERLAY (the part above already got
    // its natural reason) rather than a replacement: there is no first-class
    // "awaiting release" signal in Total ETO today, so this is the closest
    // honest approximation, not a fabricated rule.
    if (p === node.self && node.release !== "contentsOnly" && (reason === "no_po" || reason === "on_hold")) {
      blockers.push({
        reason: "awaiting_release",
        jobId,
        jobName,
        assemblyKey: node.key,
        assemblyLabel: node.label,
        partPn: p.pn,
        partDesc: p.desc,
        supplier: p.supplier,
        materialValue: 0, // already counted once under its natural reason above
        daysLate: null,
        expectedDate: p.expectedDate,
      });
    }
  }

  const buildable = buildableQtyFor(node);
  // For a real buy/build unit (node.self set) these are UNIT quantities. For a
  // "Contents Only" container or the loose-parts bucket (no self line — there
  // is no single "unit" to count), they fall back to a part-LINE count at the
  // same granularity as node.stats.pct, so readinessPct and required/covered
  // never imply two different units of measure for the same row.
  const requiredQty = node.self?.qty ?? ownParts.length;
  const coveredQty = node.self ? node.self.receivedQty : ownParts.filter((p) => p.status === "received").length;

  let estimatedBuildableDate: string | null = null;
  if (buildable && buildable.buildableQty < requiredQty && buildable.limitingParts.length > 0) {
    const byPn = new Map(node.parts.map((p) => [p.pn, p]));
    const dates = buildable.limitingParts.map((lp) => byPn.get(lp.pn)?.expectedDate ?? null);
    estimatedBuildableDate = dates.every((d) => d != null) ? dates.reduce((a, b) => (a! > b! ? a : b))! : null;
  }

  const detail: AssemblyDetail = {
    key: `${keyPrefix}${node.key}`,
    pn: node.pn,
    label: node.label,
    release: node.release,
    requiredQty,
    coveredQty,
    readinessPct: node.stats.pct,
    buildableQty: buildable?.buildableQty ?? null,
    buildablePct: buildable?.buildablePct ?? null,
    limitingParts: buildable?.limitingParts ?? [],
    missingParts,
    onOrderParts,
    pastDueParts,
    materialValue: node.self ? node.self.unitPrice * node.self.qty + node.parts.reduce((s, p) => s + partMaterialValue(p), 0) : node.parts.reduce((s, p) => s + partMaterialValue(p), 0),
    nextExpectedDelivery,
    estimatedBuildableDate,
  };

  return { detail, blockers, upcoming, blockedPartIds };
}

// Walks a whole job's BOM tree (every section -> every nested assembly, plus
// each section's own loose-parts bucket as a synthetic row) into the flat
// JobDetail shape this dashboard persists and reads. Section container nodes
// themselves are skipped (they're not a buildable unit), but everything under
// them is visited.
export function classifyJobBom(bom: JobBom, jobId: string, jobName: string, now: number): {
  detail: JobDetail;
  overallReadinessPct: number;
  assembliesTotal: number;
  assembliesReady: number;
  assembliesPartial: number;
  assembliesBlocked: number;
  partsUncovered: number;
  partsOnOrder: number;
  partsPastDue: number;
  partsDueSoon7d: number;
  materialValueTotal: number;
  materialValueAtRisk: number;
  nextUnlockDate: string | null;
} {
  const assemblies: AssemblyDetail[] = [];
  const blockers: BlockerEntry[] = [];
  const upcomingSource: { part: BomPart; assemblyLabel: string; assemblyKey: string }[] = [];
  const blockedPartIds = new Set<number>();

  let assembliesTotal = 0, assembliesReady = 0, assembliesPartial = 0, assembliesBlocked = 0;
  let statsReceived = 0, statsTotal = 0;

  const visit = (node: BomNode, keyPrefix: string) => {
    const { detail, blockers: nodeBlockers, upcoming, blockedPartIds: nodeBlocked } = classifyNode(node, keyPrefix, jobId, jobName, now);
    assemblies.push(detail);
    blockers.push(...nodeBlockers);
    for (const u of upcoming) upcomingSource.push({ part: u.part, assemblyLabel: u.assemblyLabel, assemblyKey: detail.key });
    for (const id of nodeBlocked) blockedPartIds.add(id);

    if (detail.buildableQty !== null) {
      assembliesTotal++;
      if (detail.buildableQty >= detail.requiredQty) assembliesReady++;
      else if (detail.buildableQty > 0) assembliesPartial++;
      else assembliesBlocked++;
    }
    statsReceived += node.stats.received;
    statsTotal += node.stats.total;

    for (const child of node.children) visit(child, `${keyPrefix}${node.key}/`);
  };

  for (const section of bom.roots) {
    for (const child of section.children) visit(child, "");
    if (section.parts.length > 0) {
      // Synthetic "Loose parts" bucket for a section's direct parts — no
      // `self` line (buildableQtyFor returns null for it), same as
      // JobProcurement.tsx's own LoosePartsRow treats these as a group with
      // no single "unit" concept, just individual buy items.
      const looseReceived = section.parts.filter((p) => p.status === "received").length;
      const looseTotal = section.parts.length;
      const looseNode: BomNode = {
        key: `${section.key}-loose`,
        id: `${section.key}-loose`,
        depth: section.depth + 1,
        label: "Loose parts",
        pn: "",
        desc: "",
        isAssembly: false,
        release: "contentsOnly",
        self: null,
        children: [],
        parts: section.parts,
        stats: {
          total: looseTotal,
          received: looseReceived,
          noPO: section.parts.filter((p) => p.status === "noPO").length,
          ordered: section.parts.filter((p) => p.status === "ordered").length,
          stock: section.parts.filter((p) => p.source === "stock" || p.source === "process").length,
          pct: looseTotal ? Math.round((looseReceived / looseTotal) * 100) : 0,
        },
        totalCost: 0,
        totalPartQty: 0,
        nestedAssemblies: 0,
      };
      visit(looseNode, `${section.key}/`);
    }
  }

  const now0 = now;
  const weekEnd = now0 + 7 * DAY;
  let partsUncovered = 0, partsOnOrder = 0, partsPastDue = 0, partsDueSoon7d = 0;
  for (const b of blockers) {
    if (b.reason === "no_po") partsUncovered++;
    if (b.reason === "supplier_delay" || b.reason === "past_due") partsPastDue++;
  }
  for (const u of upcomingSource) {
    if (u.part.status === "ordered") partsOnOrder++;
    const t = u.part.expectedDate ? new Date(u.part.expectedDate).getTime() : NaN;
    if (Number.isFinite(t) && t >= now0 && t <= weekEnd) partsDueSoon7d++;
  }

  const materialValueTotal = assemblies.reduce((s, a) => s + a.materialValue, 0);
  let materialValueAtRisk = 0;
  const seenBlocked = new Set<string>();
  for (const b of blockers) {
    if (b.reason === "awaiting_release") continue; // overlay only — already counted under its natural reason
    const key = `${b.assemblyKey}:${b.partPn}`;
    if (seenBlocked.has(key)) continue;
    seenBlocked.add(key);
    materialValueAtRisk += b.materialValue;
  }

  const upcomingDates = upcomingSource.map((u) => u.part.expectedDate).filter((d): d is string => !!d).sort();
  const nextUnlockDate = upcomingDates.length ? upcomingDates[0] : null;

  const upcoming: UpcomingDeliveryEntry[] = upcomingSource
    .filter((u) => u.part.expectedDate)
    .map((u) => ({
      jobId,
      jobName,
      poNumber: u.part.poId,
      supplier: u.part.supplier,
      expectedDate: u.part.expectedDate!,
      assemblyKey: u.assemblyKey,
      assemblyLabel: u.assemblyLabel,
      incomingParts: [{ pn: u.part.pn, qty: u.part.qty }],
      buildableBefore: null, // filled in by the read layer, which recomputes buildable-before/after per window
      buildableAfter: null,
    }));

  return {
    detail: { assemblies, vendors: bom.vendors, blockers, upcoming },
    overallReadinessPct: statsTotal ? Math.round((statsReceived / statsTotal) * 100) : 0,
    assembliesTotal,
    assembliesReady,
    assembliesPartial,
    assembliesBlocked,
    partsUncovered,
    partsOnOrder,
    partsPastDue,
    partsDueSoon7d,
    materialValueTotal,
    materialValueAtRisk,
    nextUnlockDate,
  };
}

// ── Persistence (raw SQL — see schema.prisma's own comment on why) ─────────

async function upsertSnapshot(jobId: string, jobName: string, customer: string | null, status: "ok" | "failed" | "empty", computed: ReturnType<typeof classifyJobBom> | null): Promise<void> {
  const c = computed ?? {
    detail: { assemblies: [], vendors: [], blockers: [], upcoming: [] },
    overallReadinessPct: 0, assembliesTotal: 0, assembliesReady: 0, assembliesPartial: 0, assembliesBlocked: 0,
    partsUncovered: 0, partsOnOrder: 0, partsPastDue: 0, partsDueSoon7d: 0,
    materialValueTotal: 0, materialValueAtRisk: 0, nextUnlockDate: null as string | null,
  };
  const detailJson = JSON.stringify(c.detail);
  await prisma.$executeRaw`
    INSERT INTO BuildReadinessJobSnapshot
      (jobId, jobName, customer, status, overallReadinessPct, assembliesTotal, assembliesReady, assembliesPartial, assembliesBlocked,
       partsUncovered, partsOnOrder, partsPastDue, partsDueSoon7d, materialValueTotal, materialValueAtRisk, nextUnlockDate, detailJson, computedAt)
    VALUES
      (${jobId}, ${jobName}, ${customer}, ${status}, ${c.overallReadinessPct}, ${c.assembliesTotal}, ${c.assembliesReady}, ${c.assembliesPartial}, ${c.assembliesBlocked},
       ${c.partsUncovered}, ${c.partsOnOrder}, ${c.partsPastDue}, ${c.partsDueSoon7d}, ${c.materialValueTotal}, ${c.materialValueAtRisk}, ${c.nextUnlockDate ? new Date(c.nextUnlockDate) : null}, ${detailJson}, NOW(3))
    ON DUPLICATE KEY UPDATE
      jobName = VALUES(jobName), customer = VALUES(customer), status = VALUES(status),
      overallReadinessPct = VALUES(overallReadinessPct), assembliesTotal = VALUES(assembliesTotal),
      assembliesReady = VALUES(assembliesReady), assembliesPartial = VALUES(assembliesPartial), assembliesBlocked = VALUES(assembliesBlocked),
      partsUncovered = VALUES(partsUncovered), partsOnOrder = VALUES(partsOnOrder), partsPastDue = VALUES(partsPastDue), partsDueSoon7d = VALUES(partsDueSoon7d),
      materialValueTotal = VALUES(materialValueTotal), materialValueAtRisk = VALUES(materialValueAtRisk),
      nextUnlockDate = VALUES(nextUnlockDate), detailJson = VALUES(detailJson), computedAt = VALUES(computedAt)
  `;
}

async function bumpMeta(fields: Partial<{ status: string; startedAt: Date; completedAt: Date; jobsTotal: number; jobsDone: number; jobsFailed: number; triggeredByName: string | null; durationMs: number }>): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    values.push(v);
  }
  if (sets.length === 0) return;
  await prisma.$executeRawUnsafe(`UPDATE BuildReadinessRefreshMeta SET ${sets.join(", ")}, updatedAt = NOW(3) WHERE id = 1`, ...values);
}

async function incrementMetaDone(failed: boolean): Promise<void> {
  await prisma.$executeRaw`
    UPDATE BuildReadinessRefreshMeta
    SET jobsDone = jobsDone + 1, jobsFailed = jobsFailed + ${failed ? 1 : 0}, updatedAt = NOW(3)
    WHERE id = 1
  `;
}

// ── Entry points ─────────────────────────────────────────────────────────────

// One job, live, awaited inline — used for the drill-down's "Refresh this
// project" action (bounded to a single job, so an inline await is reasonable
// even at ~100s).
export async function refreshOneJob(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { jobId }, select: { jobId: true, jobName: true, customer: true } });
  if (!job) return;
  const bom = await getJobBomWithRetry(job.jobId);
  if (!bom || bom.roots.length === 0) {
    await upsertSnapshot(job.jobId, job.jobName, job.customer, bom ? "empty" : "failed", null);
    return;
  }
  const computed = classifyJobBom(bom, job.jobId, job.jobName, Date.now());
  await upsertSnapshot(job.jobId, job.jobName, job.customer, "ok", computed);
}

// The full cross-job pass. Fire-and-forget from build-readiness-actions.ts —
// this function itself fully awaits its own work; it's the CALLER that
// chooses not to await it to completion.
export async function refreshBuildReadiness(triggeredByName: string | null): Promise<void> {
  const startedAt = new Date();
  const jobs = await prisma.job.findMany({ where: etcActiveJobFilter, select: { jobId: true, jobName: true, customer: true } });

  await bumpMeta({ status: "running", startedAt, jobsTotal: jobs.length, jobsDone: 0, jobsFailed: 0, triggeredByName });
  // completedAt must be cleared explicitly (a prior pass's value must not
  // linger and be misread as "this pass finished").
  await prisma.$executeRaw`UPDATE BuildReadinessRefreshMeta SET completedAt = NULL WHERE id = 1`;

  let anyFailed = false;
  await mapWithConcurrency(jobs, CONCURRENCY, async (job) => {
    const bom = await getJobBomWithRetry(job.jobId);
    const failed = bom === null;
    if (failed) anyFailed = true;
    try {
      if (!bom || bom.roots.length === 0) {
        await upsertSnapshot(job.jobId, job.jobName, job.customer, failed ? "failed" : "empty", null);
      } else {
        const computed = classifyJobBom(bom, job.jobId, job.jobName, Date.now());
        await upsertSnapshot(job.jobId, job.jobName, job.customer, "ok", computed);
      }
    } catch (err) {
      console.error(`[build-readiness] snapshot upsert failed for job ${job.jobId}:`, err);
      anyFailed = true;
    }
    await incrementMetaDone(failed);
  });

  const completedAt = new Date();
  await bumpMeta({
    status: anyFailed ? "partial" : "ok",
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
  });
}
