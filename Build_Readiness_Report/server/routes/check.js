const express = require('express');
const router = express.Router();
const eto = require('../services/eto');
const demo = require('../services/demoData');

function db() { return demo.isDemoMode() ? demo : eto; }

// GET /api/check/:projectId — lightweight pre-flight check across all systems
router.get('/:projectId', async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  if (isNaN(projectId)) {
    return res.json({
      totalEto: { found: false, projectName: null },
    });
  }

  let project = null;
  let etoError = null;
  try {
    project = await db().getProjectInfo(projectId);
  } catch (err) {
    etoError = err?.message || null;
  }

  if (etoError) console.error(`[check] ETO error for project ${projectId}:`, etoError);

  res.json({
    totalEto: {
      found:       !!project,
      projectName: project?.ProjectName || null,
      error:       etoError || null,
    },
  });
});

module.exports = router;
