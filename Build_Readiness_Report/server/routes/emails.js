const express = require('express');
const router = express.Router();
const eto = require('../services/eto');
const demo = require('../services/demoData');

function db() { return demo.isDemoMode() ? demo : eto; }

// GET /api/emails/:projectId — generate draft follow-up emails
router.get('/:projectId', async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const src = db();
    const [project, poRows] = await Promise.all([
      src.getProjectInfo(projectId),
      src.getPoDetails(projectId),
    ]);

    const now = new Date();

    // Group outstanding PO lines by supplier + PO
    const bySupplier = {};
    poRows.forEach(row => {
      if (row.ReceivedQty >= row.PurchaseQty) return;
      const key = row.Supplier || 'Unknown';
      if (!bySupplier[key]) {
        bySupplier[key] = {
          supplier: row.Supplier,
          email: row.SupplierEmail,
          phone: row.SupplierPhone,
          pos: {},
        };
      }
      const poKey = row.PurchaseOrderID;
      if (!bySupplier[key].pos[poKey]) {
        bySupplier[key].pos[poKey] = {
          poId: row.PurchaseOrderID,
          poDate: row.PurchaseDate,
          dueDate: row.PurchaseDateRequired || row.DateRequired,
          parts: [],
        };
      }
      bySupplier[key].pos[poKey].parts.push({
        partNumber: row.PartNumber,
        partDesc: row.PartDesc,
        qty: row.PurchaseQty,
        received: row.ReceivedQty,
        remaining: row.PurchaseQty - row.ReceivedQty,
      });
    });

    // Generate email drafts
    const emails = Object.values(bySupplier).map(supplier => {
      const poList = Object.values(supplier.pos);
      const poSummaries = poList.map(po => {
        const dueDate = po.dueDate ? new Date(po.dueDate) : null;
        const daysLate = dueDate ? Math.ceil((now - dueDate) / 86400000) : null;
        const isOverdue = daysLate !== null && daysLate > 0;
        const poDateStr = po.poDate ? new Date(po.poDate).toLocaleDateString() : 'N/A';
        const dueDateStr = dueDate ? dueDate.toLocaleDateString() : 'N/A';

        const urgencyLine = isOverdue
          ? `This PO is ${daysLate} day(s) past due (was due ${dueDateStr}).`
          : dueDate
            ? `This PO is due on ${dueDateStr}.`
            : '';

        const partsTable = po.parts.map(p =>
          `  - ${p.partNumber}  |  ${p.partDesc}  |  Qty: ${p.remaining} remaining`
        ).join('\n');

        return { poId: po.poId, poDateStr, urgencyLine, partsTable, isOverdue, daysLate };
      });

      const subject = poSummaries.length === 1
        ? `Follow-up — Job ${projectId} outstanding parts (PO #${poSummaries[0].poId})`
        : `Follow-up — Job ${projectId} outstanding parts (${poSummaries.length} POs)`;

      const body = `Hi,

We are following up on outstanding items for Job ${projectId}${project ? ` (${project.ProjectName})` : ''}.

${poSummaries.map(po => `PO #${po.poId} (placed ${po.poDateStr}):
${po.urgencyLine}

Outstanding items:
${po.partsTable}
`).join('\n---\n\n')}
Please confirm:
1. Ship date / tracking if already shipped
2. Updated ETA if there is a delay

Thank you,
SDC Automation Purchasing`;

      return {
        supplier: supplier.supplier,
        email: supplier.email,
        phone: supplier.phone,
        subject,
        body,
        poCount: poSummaries.length,
        isOverdue: poSummaries.some(p => p.isOverdue),
        worstDaysLate: Math.max(...poSummaries.map(p => p.daysLate || 0)),
      };
    });

    // Sort: overdue first, then by worst days late
    emails.sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      return b.worstDaysLate - a.worstDaysLate;
    });

    res.json({ emails, projectId });
  } catch (err) {
    console.error('Error generating emails:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
