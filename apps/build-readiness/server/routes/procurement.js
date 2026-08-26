const express = require('express');
const router = express.Router();
const planner = require('../services/plannerClient');
const demo = require('../services/demoData');

// GET /api/procurement/:projectId — the Delivery Slip / No Purchase Order /
// Upcoming Deliveries datasets for the Readiness tab's three risk cards.
//
// A thin proxy over the Reports app's own computation (see plannerClient.js for
// why these three insights are not derived in this app any more). Deliberately
// its own route rather than another field on /api/readiness/:projectId: that
// endpoint fans out one query per spec against Total ETO and is what gates the
// whole page, and this one waits on a second app doing its own BOM explosion.
// Separate routes mean a slow or down Reports app delays three cards, not the
// report.
//
// Always 200 with an `available` flag. A failure here is a normal condition for
// this route (the Reports app can legitimately be down or unconfigured), and
// the client renders an explicit unavailable state for it. What it must NEVER
// do is fall back to this app's old local arithmetic — that produced confidently
// wrong numbers, which is worse than an empty card and is the entire reason
// this route exists.
router.get('/:projectId', async (req, res) => {
  const projectId = String(req.params.projectId || '').trim();

  if (demo.isDemoMode()) {
    return res.json({
      available: false,
      reason: 'Procurement risk cards read live data from the SDC Projects Reports app and are not available in demo mode.',
    });
  }

  if (!planner.CONFIGURED) {
    return res.json({
      available: false,
      reason: 'Reports app integration is not configured on this server (ETC_PLANNER_URL / SCHEDULER_SHARED_TOKEN).',
    });
  }

  try {
    const risk = await planner.getProcurementRisk(projectId);
    if (!risk) {
      return res.json({ available: false, reason: `No BOM for job ${projectId} in the SDC Projects Reports app.` });
    }
    return res.json({ available: true, risk });
  } catch (err) {
    console.error(`Error fetching procurement risk for project ${projectId}:`, err.message);
    return res.json({
      available: false,
      reason: `Could not reach the SDC Projects Reports app: ${err.message}`,
    });
  }
});

module.exports = router;
