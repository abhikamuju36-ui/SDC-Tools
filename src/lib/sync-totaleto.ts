import sql from "mssql";
import { prisma } from "@/lib/prisma";
import { VALID_JOB_TYPES } from "@/lib/job-filters";

// The exact query Power BI's 'Part Purchase' table runs against this same
// SQL server (extracted verbatim from the semantic model's TMDL). Verified
// 2026-07-19: aggregated by job and windowed on Invoiced Date, this matches
// Power BI's own [Part Cost Purchased] to the dollar for every real project
// job across Mar/Apr/May 2026 — the only divergences were non-project
// pseudo-IDs (spare-parts/service buckets) that Power BI's model excludes
// anyway and that never map to an app Job. Pulling this directly removes the
// last Power BI / data-gateway dependency for the live ETC month's parts.
const PART_PURCHASE_SQL = `-- Part Costs
SELECT
     [P].[ProjectID] as [Job ID]
    ,POD.[SpecID] as [Section ID]
    ,CASE WHEN POD.PurchaseQty >=0 THEN
        CASE WHEN InvoicedQty > (CASE WHEN RLS.SumOfQtyReceived >= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END)
             THEN 0
             ELSE ((CASE WHEN RLS.SumOfQtyReceived >= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END) - ISNULL(InvoicedQty,0))
        END * POD.PurchasePrice * POH.PurchaseCurrRate
    ELSE
        CASE WHEN InvoicedQty < (CASE WHEN RLS.SumOfQtyReceived >= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END)
             THEN 0
             ELSE ((CASE WHEN RLS.SumOfQtyReceived <= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END) - ISNULL(InvoicedQty,0))
        END * POD.PurchasePrice * POH.PurchaseCurrRate
    END + ISNULL(INVOICED.TotalInvoicedAmount, 0) AS [Total Price]
    ,INVOICED.[APDocDate] as [Invoiced Date]
FROM tblPurchaseOrderHeader POH with(nolock)
    INNER JOIN tblPurchaseOrderDetails POD with(nolock) ON POH.PurchaseOrderID = POD.PurchaseOrderID
    LEFT JOIN tblSpec S with(nolock) ON S.SpecID = POD.SpecID AND S.ProjectID = POD.ProjectID
    LEFT JOIN tblProjects P with(nolock) ON S.ProjectID = P.ProjectID
    LEFT JOIN ( SELECT APDD.PurchaseDetailID, BatchEntryTypeID, max(APDocDate) as APDocDate, SUM(APDocQty) AS InvoicedQty,
                    SUM(APDocQty * APDocUnitPrice * (1 - APDocItemPctDisc) * APDocCurrRate) AS TotalInvoicedAmount
                    FROM tblAPDocumentDetails APDD with(nolock)
                        INNER JOIN tblAPBatchDocument APBD with(nolock) ON APBD.APDocID = APDD.APDocID
                    WHERE BatchEntryTypeID NOT IN (2, 3) AND APDD.PurchaseDetailID IS NOT NULL
                    GROUP BY APDD.PurchaseDetailID, BatchEntryTypeID
                ) INVOICED ON POD.PurchaseDetailID = INVOICED.PurchaseDetailID
    LEFT JOIN vwReceiverLogSummed RLS with(nolock) ON RLS.PurchaseDetailID = POD.PurchaseDetailID

UNION ALL

-- Extra Costs
SELECT
     [EC].[ProjectID] as [Job ID]
    ,[EC].[SpecID] as [Section ID]
    ,[EC].[decExtraCostingValue] as [Total Price]
    ,[EC].[APDocDate] as [Invoiced Date]
FROM [dbo].[vwCostingExtraCostsDetailed] [EC] WITH(NOLOCK)`;

// ── Money Spent Month, by PURCHASED date (§30, 2026-08-04) ──────────────────
//
// Replaces the invoiced-date basis below. The rule, as decided: a part belongs to the
// month it was PURCHASED, because parts are routinely invoiced months after the buy
// and the ETC month is about what was committed in it.
//
// Three deliberate choices, each of which changes the figure:
//
//   * DATE — POH.PurchaseDate, the purchase-order header date. Not the receiver date
//     (when it arrived) and not APDocDate (when it was billed).
//
//   * AMOUNT — PurchaseQty × PurchasePrice × PurchaseCurrRate. This is NOT the
//     [Total Price] the invoiced-date query uses. That one is
//     `remaining-uninvoiced-balance + everything-invoiced-to-date`, a point-in-time
//     snapshot that cannot be attributed to any single date: window it by PO date and
//     a month's figure would keep MOVING as invoices landed against POs placed in it,
//     retroactively changing months that had already been submitted. The committed
//     PO value is stable — once a PO is placed, its contribution to that month never
//     changes again, which is the property a closed month needs.
//     The currency rate stays: without it a foreign-currency PO would be counted in
//     its own units.
//
//   * SCOPE — Part Costs ONLY. The Extra Costs branch (shipping, fees, tariffs) comes
//     from vwCostingExtraCostsDetailed, which carries no purchase date at all, so
//     there is nothing to window it on. Excluded outright rather than silently kept on
//     the invoiced-date basis, which would put two different rules in one total.
//
// Consequence worth stating: this figure no longer matches Power BI's
// [Part Cost Purchased], which the invoiced-date query was verified against to the
// dollar on 2026-07-19. The two now measure different things on purpose.
//
// Locked months are protected by syncPartsCost's own isMonthLocked guard, so applying
// this rule cannot rewrite a submitted month's stored figures.
export async function getPartsCostPurchasedByJob(monthStart: Date, monthEndExclusive: Date): Promise<Map<string, number>> {
  const pool = await sql.connect({ ...config, requestTimeout: 120000 });
  try {
    const result = await pool
      .request()
      .input("start", sql.DateTime, monthStart)
      .input("end", sql.DateTime, monthEndExclusive)
      .query(
        `SELECT [P].[ProjectID] AS JobId,
                SUM(POD.PurchaseQty * POD.PurchasePrice * POH.PurchaseCurrRate) AS Purchased
           FROM tblPurchaseOrderHeader POH WITH(NOLOCK)
                INNER JOIN tblPurchaseOrderDetails POD WITH(NOLOCK) ON POH.PurchaseOrderID = POD.PurchaseOrderID
                LEFT JOIN tblSpec S WITH(NOLOCK) ON S.SpecID = POD.SpecID AND S.ProjectID = POD.ProjectID
                LEFT JOIN tblProjects P WITH(NOLOCK) ON S.ProjectID = P.ProjectID
          WHERE POH.PurchaseDate >= @start
            AND POH.PurchaseDate <  @end
            AND [P].[ProjectID] IS NOT NULL
          GROUP BY [P].[ProjectID]`,
      );
    const map = new Map<string, number>();
    for (const r of result.recordset) {
      const purchased = Number(r.Purchased);
      // A null/NaN sum is a data problem, not a zero — skipping keeps it out of the
      // month rather than silently reporting nothing bought (§30.14).
      if (Number.isFinite(purchased)) map.set(String(Number(r.JobId)), purchased);
    }
    return map;
  } finally {
    await pool.close();
  }
}

// ── Money Spent Month, reconciled to the Total ETO report (§41) ──────────────
//
// THE authoritative Money Spent Month figure. Everything else in this file that looks
// like a monthly spend is either a different measure or superseded; see below.
//
// Reconciled 2026-08-05 against the Total ETO pivot for July 2026 ("Sum of Debit Amt /
// Sum of Credit Amt / Sum of Net DR/CR"): 31 of 35 jobs to the dollar, total $420,616
// against the pivot's $420,656 — a 0.0095% residual on four jobs. The proof is
// re-runnable: scripts/parts-spent-recon.ts.
//
// ── The two formulas this replaces, and why each was wrong ──────────────────
//
// 1. `getPartsCostSpentByJob` sums `[Total Price]`, which is
//    "remaining-uninvoiced-balance + everything-invoiced-to-date". That is a
//    point-in-time PO snapshot, not a monthly flow: a job carrying a large open PO
//    contributes the PO's whole undelivered value to any month it was touched in.
//    Job 1142, July 2026: $1,065,713 reported against the pivot's $113,101.
//
// 2. `getPartsCostPurchasedByJob` (§30) sums the committed PO value on POH.PurchaseDate.
//    Stable and defensible, and it is what the app shipped with — but it is not what the
//    business's own report measures, and it was off by $30,117 for the month and by
//    multiples on individual jobs (1160: app $103,231 vs pivot $17,427).
//
// ── The definitions, spelled out (§41.4) ────────────────────────────────────
//
//   DATE    APBD.APDocDate — the AP document date, on the BATCH DOCUMENT table.
//           This is what the pivot windows on. NOTE FOR WHOEVER READS §41.3: the
//           business calls this the "Purchased Date", but it is NOT
//           POH.PurchaseDate. A part bought in June and billed in July lands in
//           JULY on this basis. That is the reference report's rule, not a choice
//           made here.
//   AMOUNT  APDocQty x APDocUnitPrice x (1 - APDocItemPctDisc) x APDocCurrRate.
//           Qty, price and line discount are on the DETAIL row; the currency rate
//           and the date are on the BATCH DOCUMENT. Mixing those up fails with
//           "Invalid column name 'APDocCurrRate'".
//   SIGN    Kept. A credit memo is a negative line and nets off, which is exactly
//           what the pivot's Credit column does ($2,584 across 7 jobs in July;
//           job 1127's $1,300 credit reconciles to the cent).
//   JOB     APDD.ProjectID, straight off the AP line — not the PO -> Spec -> Project
//           chain the other queries walk. In July 2026 every AP line carried one, so
//           nothing is silently unattributed; `unmatchedLines` reports it if that
//           ever stops being true.
//   SCOPE   Part-cost AP lines only. Extra Costs (shipping, fees, tariffs) are
//           EXCLUDED, and that is now a measured fact rather than a convenience:
//           July had $39,987 of them across 23 jobs, and including any of it would
//           have moved the four residual jobs the wrong way (1153 carries $624.85 of
//           extra costs while sitting $2 BELOW the pivot).
//   DEDUPE  None needed, and none applied. The grain is the AP document line
//           (APDocDetailID), which is already one row per booked line, so there is
//           nothing to collapse — and deduping on amount+date would destroy genuine
//           repeat purchases (§41.7).
//   ARCHIVED  NOT filtered. `Archived = 1` on 774 of July's 818 lines, so it plainly
//           does not mean "void"; filtering it would have reported $39,987 instead
//           of $491,206.
export type PartsBookedByJob = {
  /** job number -> net booked amount for the month (credits already netted off). */
  net: Map<string, number>;
  /** Debits and credits kept apart, so a reconciliation can compare all three columns. */
  debit: Map<string, number>;
  credit: Map<string, number>;
  /** AP lines in the window carrying no ProjectID — nobody's spend. Should stay 0. */
  unmatchedLines: number;
  unmatchedAmount: number;
};

const AP_LINE_AMOUNT =
  "(APDD.APDocQty * APDD.APDocUnitPrice * (1 - APDD.APDocItemPctDisc) * APBD.APDocCurrRate)";

export async function getPartsCostBookedByJob(
  monthStart: Date,
  monthEndExclusive: Date,
): Promise<PartsBookedByJob> {
  const pool = await sql.connect({ ...config, requestTimeout: 180000 });
  try {
    const amt = AP_LINE_AMOUNT;
    const result = await pool
      .request()
      .input("start", sql.DateTime, monthStart)
      .input("end", sql.DateTime, monthEndExclusive)
      .query(
        `SELECT APDD.ProjectID AS JobId,
                SUM(CASE WHEN ${amt} > 0 THEN ${amt} ELSE 0 END) AS DebitAmt,
                SUM(CASE WHEN ${amt} < 0 THEN -(${amt}) ELSE 0 END) AS CreditAmt,
                SUM(${amt}) AS NetAmt
           FROM tblAPDocumentDetails APDD WITH(NOLOCK)
                INNER JOIN tblAPBatchDocument APBD WITH(NOLOCK) ON APBD.APDocID = APDD.APDocID
          WHERE APBD.APDocDate >= @start AND APBD.APDocDate < @end
            AND APDD.ProjectID IS NOT NULL
          GROUP BY APDD.ProjectID`,
      );
    const net = new Map<string, number>();
    const debit = new Map<string, number>();
    const credit = new Map<string, number>();
    for (const r of result.recordset) {
      const job = String(Number(r.JobId));
      const n = Number(r.NetAmt);
      // A null/NaN sum is a data problem, not a zero — skipping keeps it out of the month
      // rather than silently reporting nothing bought (§30.14).
      if (!Number.isFinite(n)) continue;
      net.set(job, n);
      debit.set(job, Number(r.DebitAmt) || 0);
      credit.set(job, Number(r.CreditAmt) || 0);
    }

    // Anything the month booked that no job will ever show. Reported rather than
    // dropped silently (§41.6) — a purchase must never be reassigned to another job.
    const un = await pool
      .request()
      .input("start", sql.DateTime, monthStart)
      .input("end", sql.DateTime, monthEndExclusive)
      .query(
        `SELECT COUNT(*) AS Lines, ISNULL(SUM(${amt}), 0) AS Amt
           FROM tblAPDocumentDetails APDD WITH(NOLOCK)
                INNER JOIN tblAPBatchDocument APBD WITH(NOLOCK) ON APBD.APDocID = APDD.APDocID
          WHERE APBD.APDocDate >= @start AND APBD.APDocDate < @end
            AND APDD.ProjectID IS NULL`,
      );
    return {
      net,
      debit,
      credit,
      unmatchedLines: Number(un.recordset[0]?.Lines ?? 0),
      unmatchedAmount: Number(un.recordset[0]?.Amt ?? 0),
    };
  } finally {
    await pool.close();
  }
}

// Parts Cost cumulative "Parts Cost Actual" per job, straight from TotalETO —
// SUM(Total Price) for rows whose Invoiced Date falls in [monthStart,
// monthEndExclusive). Keyed by numeric Job Id string (e.g. "1150"), matching
// how the rest of the app keys jobs. A longer request timeout than the
// project sync since this query fans out across the full PO/AP history.
//
// NOT Money Spent Month — see getPartsCostBookedByJob above for that. `[Total Price]`
// includes each PO's uninvoiced remaining balance, which is meaningful for the Projects
// grid's lifetime-to-date column (called with a 1990-2100 window) and badly wrong for a
// single month. Do not window this by month and call it a monthly spend.
export async function getPartsCostSpentByJob(monthStart: Date, monthEndExclusive: Date): Promise<Map<string, number>> {
  const pool = await sql.connect({ ...config, requestTimeout: 120000 });
  try {
    const result = await pool
      .request()
      .input("start", sql.DateTime, monthStart)
      .input("end", sql.DateTime, monthEndExclusive)
      .query(
        `WITH pp AS (\n${PART_PURCHASE_SQL}\n)\n` +
          `SELECT [Job ID] AS JobId, SUM([Total Price]) AS Spent FROM pp ` +
          `WHERE [Invoiced Date] >= @start AND [Invoiced Date] < @end AND [Job ID] IS NOT NULL ` +
          `GROUP BY [Job ID]`
      );
    const map = new Map<string, number>();
    for (const r of result.recordset) {
      const spent = Number(r.Spent);
      if (Number.isFinite(spent)) map.set(String(Number(r.JobId)), spent);
    }
    return map;
  } finally {
    await pool.close();
  }
}

// ── Per-job Parts Cost detail (live) — for the Job Hour Details dashboard ────
// Per-part line items + rollups, straight from TotalETO, mirroring the Power BI
// "Parts Cost" table. Part Costs branch joins supplier (tblCompany), item
// master (manufacturer / part# / category); Extra Costs branch (fees, shipping,
// tariffs) comes from vwCostingExtraCostsDetailed.
export type PartsCostLine = {
  purchaseDate: string | null;
  invoicedDate: string | null;
  supplier: string | null;
  manufacturer: string | null;
  category: string | null;
  poNumber: string | null;
  partNumber: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number; // "Purchased"
  invoicedAmount: number; // "Paid"
};

export type JobPartsCost = {
  purchased: number;
  paid: number;
  leftToPay: number;
  lines: PartsCostLine[];
};

// Per-line "purchased" amount — the same remaining-uninvoiced + invoiced formula
// PART_PURCHASE_SQL aggregates, kept per line here.
const LINE_TOTAL_PRICE = `
  CASE WHEN POD.PurchaseQty >= 0 THEN
    CASE WHEN ISNULL(INV.InvoicedQty,0) > (CASE WHEN RLS.SumOfQtyReceived >= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END)
      THEN 0
      ELSE ((CASE WHEN RLS.SumOfQtyReceived >= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END) - ISNULL(INV.InvoicedQty,0))
    END * POD.PurchasePrice * POH.PurchaseCurrRate
  ELSE
    CASE WHEN ISNULL(INV.InvoicedQty,0) < (CASE WHEN RLS.SumOfQtyReceived >= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END)
      THEN 0
      ELSE ((CASE WHEN RLS.SumOfQtyReceived <= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END) - ISNULL(INV.InvoicedQty,0))
    END * POD.PurchasePrice * POH.PurchaseCurrRate
  END + ISNULL(INV.TotalInvoicedAmount, 0)`;

const PARTS_DETAIL_SQL = `
SELECT
   CONVERT(varchar(10), POH.PurchaseDate, 23) AS PurchaseDate
  ,CONVERT(varchar(10), INV.APDocDate, 23) AS InvoicedDate
  ,SUP.CName AS Supplier
  ,IM.Manufacturer AS Manufacturer
  ,CAT.CategoryDescription AS Category
  ,CAST(POH.PurchaseOrderID AS varchar(32)) AS PONumber
  ,COALESCE(NULLIF(POD.PurchaseSupplierItem,''), IM.ManufacturerPartNumber) AS PartNumber
  ,COALESCE(NULLIF(POD.PurchaseSupplierDescription,''), IM.ItemDescription) AS Description
  ,POD.PurchaseQty AS Qty
  ,(POD.PurchasePrice * POH.PurchaseCurrRate) AS UnitPrice
  ,(${LINE_TOTAL_PRICE}) AS TotalPrice
  ,ISNULL(INV.TotalInvoicedAmount, 0) AS InvoicedAmount
FROM tblPurchaseOrderHeader POH WITH(NOLOCK)
  INNER JOIN tblPurchaseOrderDetails POD WITH(NOLOCK) ON POH.PurchaseOrderID = POD.PurchaseOrderID
  LEFT JOIN tblCompany SUP WITH(NOLOCK) ON SUP.CompanyID = POH.PurchaseSupplierID
  LEFT JOIN tblEngItemMaster IM WITH(NOLOCK) ON IM.ItemID = POD.ItemID
  LEFT JOIN tlkpItemMaster_Categories CAT WITH(NOLOCK) ON CAT.ItemCategory = IM.ItemCategory
  LEFT JOIN ( SELECT APDD.PurchaseDetailID, max(APDocDate) AS APDocDate, SUM(APDocQty) AS InvoicedQty,
                SUM(APDocQty * APDocUnitPrice * (1 - APDocItemPctDisc) * APDocCurrRate) AS TotalInvoicedAmount
              FROM tblAPDocumentDetails APDD WITH(NOLOCK)
                INNER JOIN tblAPBatchDocument APBD WITH(NOLOCK) ON APBD.APDocID = APDD.APDocID
              WHERE BatchEntryTypeID NOT IN (2, 3) AND APDD.PurchaseDetailID IS NOT NULL
              GROUP BY APDD.PurchaseDetailID ) INV ON POD.PurchaseDetailID = INV.PurchaseDetailID
  LEFT JOIN vwReceiverLogSummed RLS WITH(NOLOCK) ON RLS.PurchaseDetailID = POD.PurchaseDetailID
WHERE POD.ProjectID = @job

UNION ALL

SELECT
   CONVERT(varchar(10), EC.APDocDate, 23) AS PurchaseDate
  ,CONVERT(varchar(10), EC.APDocDate, 23) AS InvoicedDate
  ,EC.Vendor AS Supplier
  ,NULL AS Manufacturer
  ,EC.APDocDesc AS Category
  ,CAST(EC.APDocNumber AS varchar(32)) AS PONumber
  ,EC.PurchaseSupplierItem AS PartNumber
  ,EC.APDocItemDesc AS Description
  ,EC.APDocQty AS Qty
  ,(EC.APDocUnitPrice * EC.APDocCurrRate) AS UnitPrice
  ,EC.decExtraCostingValue AS TotalPrice
  ,EC.decExtraCostingValue AS InvoicedAmount
FROM vwCostingExtraCostsDetailed EC WITH(NOLOCK)
WHERE EC.ProjectID = @job`;

export async function getJobPartsCost(jobId: string): Promise<JobPartsCost> {
  const numericJob = Number(jobId);
  if (!Number.isFinite(numericJob)) return { purchased: 0, paid: 0, leftToPay: 0, lines: [] };
  const pool = await sql.connect({ ...config, requestTimeout: 120000 });
  try {
    const result = await pool.request().input("job", sql.Int, numericJob).query(PARTS_DETAIL_SQL);
    const lines: PartsCostLine[] = result.recordset.map((r) => ({
      purchaseDate: r.PurchaseDate ?? null,
      invoicedDate: r.InvoicedDate ?? null,
      supplier: r.Supplier ?? null,
      manufacturer: r.Manufacturer ?? null,
      category: r.Category ?? null,
      poNumber: r.PONumber ?? null,
      partNumber: r.PartNumber ?? null,
      description: r.Description ?? null,
      quantity: Number(r.Qty) || 0,
      unitPrice: Number(r.UnitPrice) || 0,
      totalPrice: Number(r.TotalPrice) || 0,
      invoicedAmount: Number(r.InvoicedAmount) || 0,
    }));
    // Sort newest purchase first; drop fully-zero noise rows.
    const meaningful = lines.filter((l) => l.totalPrice !== 0 || l.invoicedAmount !== 0 || l.quantity !== 0);
    meaningful.sort((a, b) => (b.purchaseDate ?? "").localeCompare(a.purchaseDate ?? ""));
    const purchased = meaningful.reduce((s, l) => s + l.totalPrice, 0);
    const paid = meaningful.reduce((s, l) => s + l.invoicedAmount, 0);
    return { purchased, paid, leftToPay: purchased - paid, lines: meaningful };
  } finally {
    await pool.close();
  }
}

// Credentials come from the environment, same as every other integration in
// this app (Power BI, Auth, Standard Sheet password) — this was previously
// the one exception, with a live username/password hardcoded in this file.
// Set TOTALETO_DB_USER / TOTALETO_DB_PASSWORD in .env (gitignored).
const config: sql.config = {
  server: "SERVER-APP1.stevendouglas.local",
  database: "SDC",
  user: process.env.TOTALETO_DB_USER,
  password: process.env.TOTALETO_DB_PASSWORD,
  domain: "stevendouglas",
  port: 1433,
  options: { trustServerCertificate: true, encrypt: false },
  connectionTimeout: 15000,
  requestTimeout: 30000,
};

interface TotalEtoProject {
  "Job ID": number;
  Description: string;
  Customer: string | null;
  Status: string;
}

interface TotalEtoCosting {
  "Job ID": number;
  EstEngHours: number | null;
  ActEngHours: number | null;
  EstMfgHours: number | null;
  ActMfgHours: number | null;
}

// Pulls active ("Sold") projects + actuals-vs-estimates costing from the
// TotalETO production database (vwProjects / vwProjectActualsVSEstimates —
// the same views the TotalETO MCP connector uses) and upserts into Job.
//
// TotalETO has no project "Type" (Custom/Duplicate/Hybrid/Service) field —
// that classification only exists in the spreadsheet-derived data. Per
// requirement, jobs with no Type must never be imported or shown, so this
// sync only UPDATES jobs that already exist with a valid Type; it never
// creates a new job (which would necessarily have Type = null).
// ── Parts Cost Actual (Job.costActualHistorical) ────────────────────────────
//
// The Projects grid's "Parts Cost Actual" column, filled from TotalETO instead
// of typed in.
//
// Policy set 2026-08-03: Jessica enters new projects, their quoted hours and
// their Parts Cost Quoted; the app pulls actual hours and actual parts cost. This
// is the second half of that — the column was manager-entered and had NO sync at
// all (Power BI's model has no equivalent measure; see the note in
// sync-powerbi.ts).
//
// TotalETO over Power BI, deliberately. getPartsCostSpentByJob runs the same
// query Power BI's own 'Part Purchase' table runs, verified 2026-07-19 to match
// its [Part Cost Purchased] to the dollar for every real project job — so the two
// agree, and TotalETO is live where the model waits for a scheduled refresh. It
// is also already the source for the ETC grid's "Money Spent Month", so this
// column and that row can never tell different stories.
//
// Cumulative, not per-month: the column is a running actual. Windowed from 1990
// to 2100 rather than by a "since" date, because a job's parts can be invoiced
// long before its ETC tracking starts.
//
// Every job with a real Type, whatever its Status — Complete jobs are precisely
// the ones whose parts spend is finished and worth reporting, and they were the
// rows sitting empty.
export async function syncPartsCostActual(): Promise<{ jobsUpdated: number; jobsNotFound: number }> {
  const spentByJobId = await getPartsCostSpentByJob(new Date(Date.UTC(1990, 0, 1)), new Date(Date.UTC(2100, 0, 1)));

  const jobs = await prisma.job.findMany({
    where: { type: { in: [...VALID_JOB_TYPES] } },
    select: { id: true, jobId: true, costActualHistorical: true },
  });
  const byJobId = new Map(jobs.map((j) => [j.jobId, j]));

  let jobsUpdated = 0;
  let jobsNotFound = 0;
  for (const [jobId, spent] of spentByJobId) {
    const job = byJobId.get(jobId);
    if (!job) {
      // TotalETO carries spare-parts/service pseudo-IDs that never map to an app
      // job. Counted, not warned about one by one.
      jobsNotFound++;
      continue;
    }
    // Only write a real change: this runs on every pass, and rewriting an
    // identical Decimal would churn updatedAt on all 233 rows for nothing.
    const current = job.costActualHistorical == null ? null : Number(job.costActualHistorical);
    const next = Math.round(spent * 100) / 100;
    if (current != null && Math.abs(current - next) < 0.005) continue;
    await prisma.job.update({ where: { id: job.id }, data: { costActualHistorical: next } });
    jobsUpdated++;
  }
  return { jobsUpdated, jobsNotFound };
}

export async function syncFromTotalEto(): Promise<{ jobsUpdated: number; skippedNoType: number }> {
  const pool = await sql.connect(config);
  try {
    const projects = await pool.request().query<TotalEtoProject>(`
      SELECT
        P.ProjectID AS [Job ID],
        P.PDescription AS [Description],
        P.CName AS [Customer],
        P.PStatus AS [Status]
      FROM vwProjects P WITH(NOLOCK)
      WHERE P.PStatus = 'Sold'
      ORDER BY P.PDelivery ASC
    `);

    const costing = await pool.request().query<TotalEtoCosting>(`
      SELECT
        C.ProjectID AS [Job ID],
        C.EstEngHours, C.ActEngHours, C.EstMfgHours, C.ActMfgHours
      FROM vwProjectActualsVSEstimates C WITH(NOLOCK)
      WHERE C.ProjectID IN (SELECT ProjectID FROM tblProjects WITH(NOLOCK) WHERE PStatus = 'Sold')
    `);
    const costingByJobId = new Map(costing.recordset.map((c) => [c["Job ID"], c]));

    const existingJobs = await prisma.job.findMany({
      where: { jobId: { in: projects.recordset.map((p) => String(p["Job ID"])) }, type: { in: [...VALID_JOB_TYPES] } },
      select: { jobId: true, customerManuallyEdited: true },
    });
    const existingJobIds = new Set(existingJobs.map((j) => j.jobId));
    // A manager's manual Customer edit on the Projects tab must survive this
    // sync instead of being silently overwritten — see customerManuallyEdited.
    const manuallyEditedJobIds = new Set(existingJobs.filter((j) => j.customerManuallyEdited).map((j) => j.jobId));

    let jobsUpdated = 0;
    let skippedNoType = 0;
    const now = new Date();
    for (const p of projects.recordset) {
      const jobId = String(p["Job ID"]);
      if (!existingJobIds.has(jobId)) {
        skippedNoType++;
        continue;
      }
      const c = costingByJobId.get(p["Job ID"]);

      await prisma.job.update({
        where: { jobId },
        data: {
          ...(manuallyEditedJobIds.has(jobId) ? {} : { customer: p.Customer }),
          totEtoEstEngHours: c?.EstEngHours ?? undefined,
          totEtoActEngHours: c?.ActEngHours ?? undefined,
          totEtoEstMfgHours: c?.EstMfgHours ?? undefined,
          totEtoActMfgHours: c?.ActMfgHours ?? undefined,
          totEtoSyncedAt: now,
        },
      });
      jobsUpdated++;
    }

    return { jobsUpdated, skippedNoType };
  } finally {
    await pool.close();
  }
}
