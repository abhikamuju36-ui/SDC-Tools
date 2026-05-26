const express = require('express');
const router = express.Router();
const eto = require('../services/eto');
const demo = require('../services/demoData');
const { findScheduleSheet } = require('../services/smartsheet');

function db() { return demo.isDemoMode() ? demo : eto; }

// GET /api/check/:projectId — lightweight pre-flight check across all systems
router.get('/:projectId', async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (isNaN(projectId)) {
    return res.json({
      totalEto:   { found: false, projectName: null },
      smartsheet: { found: false, sheetName: null },
    });
  }

  const [etoResult, ssResult] = await Promise.allSettled([
    db().getProjectInfo(projectId),
    findScheduleSheet(projectId),
  ]);

  const project = etoResult.status === 'fulfilled' ? etoResult.value : null;
  const sheet   = ssResult.status  === 'fulfilled' ? ssResult.value  : null;

  res.json({
    totalEto: {
      found:       !!project,
      projectName: project?.ProjectName || null,
    },
    smartsheet: {
      found:     !!sheet,
      sheetName: sheet?.name || null,
    },
  });
});

module.exports = router;
