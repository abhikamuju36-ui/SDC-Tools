import sql from "mssql";
import { totalEtoConfig, TOTALETO_TIMEOUT } from "@/lib/totaleto-connection";

// Record-level drill-through behind one Cash Flow cell — CURRENT only. A
// stored snapshot keeps only the aggregated (project, month, category)
// amount (CashFlowSnapshotLine has no line-item detail — storing every
// invoice/PO row per snapshot would multiply storage for a feature whose own
// point is compact historical comparison, not a permanent invoice archive),
// so a historical "As Of" cell's drill panel shows the total only; these
// queries back "Current" drill-through, always live against Total ETO.

// The connection config moved to lib/totaleto-connection.ts (2026-09-01):
// this file held one of FOUR byte-identical copies, which is what made a single
// shared credential failure look like four unrelated ones. `config` below is that
// shared definition, with this file's own requestTimeout.
const config = totalEtoConfig(TOTALETO_TIMEOUT.sync);

function toIso(d: unknown): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(String(d));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type ArDrillRow = {
  customer: string | null;
  invoiceNumber: string | null;
  description: string | null;
  amount: number;
  invoiceDate: string | null;
  dueDate: string | null;
  status: string; // "Invoiced" | "Pending"
};

export async function fetchArDrillRows(projectId: string): Promise<ArDrillRow[]> {
  const pool = await new sql.ConnectionPool(config).connect();
  try {
    const result = await pool
      .request()
      .input("projectId", sql.Int, Number(projectId))
      .query(`
        SELECT
          T.Description AS Description,
          T.ARTAmount AS TermAmount,
          T.ARTReleased AS Released,
          T.ARTDate AS TermDate,
          H.ARDocInvoiceNumber AS InvoiceNumber,
          H.ARDocDate AS InvoiceDate,
          H.ARDueDate AS InvoiceDueDate,
          D.ARDocAmount AS InvoiceAmount
        FROM tblARSalesTerms T WITH(NOLOCK)
        LEFT JOIN tblARDocumentDetails D WITH(NOLOCK)
          ON D.ARDocTermPrj = T.ARTProjectId AND D.ARDocTermId = T.ARTTermId
        LEFT JOIN tblARDocumentHeader H WITH(NOLOCK)
          ON H.ARDocId = D.ARDocHeaderId AND ISNULL(H.ARDocDeleted, 0) = 0
        WHERE T.ARTProjectId = @projectId AND ISNULL(T.Archived, 0) = 0
        ORDER BY ISNULL(H.ARDueDate, T.ARTDate)
      `);
    return result.recordset.map((r) => {
      const released = !!r.Released;
      return {
        customer: null,
        invoiceNumber: r.InvoiceNumber != null ? String(r.InvoiceNumber) : null,
        description: r.Description ?? null,
        amount: released && r.InvoiceAmount != null ? num(r.InvoiceAmount) : num(r.TermAmount),
        invoiceDate: released ? toIso(r.InvoiceDate) : null,
        dueDate: released ? (toIso(r.InvoiceDueDate) ?? toIso(r.TermDate)) : toIso(r.TermDate),
        status: released ? "Invoiced" : "Pending",
      };
    });
  } finally {
    await pool.close();
  }
}

export type ApDrillRow = {
  supplier: string | null;
  invoiceNumber: string | null;
  amount: number;
  invoiceDate: string | null;
  dueDate: string | null;
};

const AP_LINE_AMOUNT = "(APDD.APDocQty * APDD.APDocUnitPrice * (1 - APDD.APDocItemPctDisc) * APBD.APDocCurrRate)";

export async function fetchApDrillRows(projectId: string): Promise<ApDrillRow[]> {
  const pool = await new sql.ConnectionPool(config).connect();
  try {
    const result = await pool
      .request()
      .input("projectId", sql.Int, Number(projectId))
      .query(`
        SELECT
          APBD.APDocNumber AS InvoiceNumber,
          APBD.APDocDate AS InvoiceDate,
          APBD.APDocDueDate AS DueDate,
          SUM(${AP_LINE_AMOUNT}) AS Amount
        FROM tblAPDocumentDetails APDD WITH(NOLOCK)
        JOIN tblAPBatchDocument APBD WITH(NOLOCK) ON APBD.APDocID = APDD.APDocID
        WHERE APDD.ProjectID = @projectId
          AND ISNULL(APBD.APDocDoNotExport, 0) = 0
          AND ISNULL(APDD.Archived, 0) = 0
        GROUP BY APBD.APDocNumber, APBD.APDocDate, APBD.APDocDueDate
        ORDER BY APBD.APDocDueDate
      `);
    return result.recordset.map((r) => ({
      supplier: null,
      invoiceNumber: r.InvoiceNumber ?? null,
      amount: num(r.Amount),
      invoiceDate: toIso(r.InvoiceDate),
      dueDate: toIso(r.DueDate),
    }));
  } finally {
    await pool.close();
  }
}

export type PoDrillRow = {
  poNumber: string | null;
  supplier: string | null;
  expectedDate: string | null;
  orderedAmount: number;
  invoicedAmount: number;
  remainingAmount: number;
};

export async function fetchPoDrillRows(projectId: string): Promise<PoDrillRow[]> {
  const pool = await new sql.ConnectionPool(config).connect();
  try {
    const result = await pool
      .request()
      .input("projectId", sql.Int, Number(projectId))
      .query(`
        SELECT
          POH.PurchaseOrderID AS PoNumber,
          ISNULL(POD.DateRequired, POH.PurchaseDateRequired) AS ExpectedDate,
          (POD.PurchaseQty * POD.PurchasePrice) AS OrderedAmount,
          ISNULL(AP.InvoicedAmount, 0) AS InvoicedAmount
        FROM tblPurchaseOrderDetails POD WITH(NOLOCK)
        JOIN tblPurchaseOrderHeader POH WITH(NOLOCK) ON POH.PurchaseOrderID = POD.PurchaseOrderID
        OUTER APPLY (
          SELECT SUM(${AP_LINE_AMOUNT}) AS InvoicedAmount
          FROM tblAPDocumentDetails APDD WITH(NOLOCK)
          JOIN tblAPBatchDocument APBD WITH(NOLOCK) ON APBD.APDocID = APDD.APDocID
          WHERE APDD.PurchaseDetailID = POD.PurchaseDetailID AND ISNULL(APBD.APDocDoNotExport, 0) = 0
        ) AP
        WHERE POD.ProjectID = @projectId AND ISNULL(POD.Archived, 0) = 0
        ORDER BY ExpectedDate
      `);
    return result.recordset
      .map((r) => ({
        poNumber: r.PoNumber != null ? String(r.PoNumber) : null,
        supplier: null,
        expectedDate: toIso(r.ExpectedDate),
        orderedAmount: num(r.OrderedAmount),
        invoicedAmount: num(r.InvoicedAmount),
        remainingAmount: Math.max(0, num(r.OrderedAmount) - num(r.InvoicedAmount)),
      }))
      .filter((r) => r.remainingAmount > 0.005);
  } finally {
    await pool.close();
  }
}
