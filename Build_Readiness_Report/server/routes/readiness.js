const express = require('express');
const router  = express.Router();
const eto     = require('../services/eto');
const { getBuildDates } = require('../services/smartsheet');
const { buildTree, buildReadinessSummary, buildPoActionList, buildPoIndex, findNoPoParts } = require('../lib/bomTree');

// GET /api/readiness/:projectId — full readiness report
router.get('/:projectId', async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId, 10);
    if (isNaN(projectId) || projectId <= 0) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }

    // Verify ETO is reachable before proceeding
    try {
      await eto.getPool();
    } catch (etoErr) {
      return res.status(503).json({
        error: 'ETO database is not reachable. Check that you are on the company network and ETO SQL Server is running.',
        detail: etoErr.message,
      });
    }

    const [project, specs, poRows, buildDates, projectCosting, specCosting] = await Promise.all([
      eto.getProjectInfo(projectId),
      eto.getSpecs(projectId),
      eto.getPoDetails(projectId),
      getBuildDates(projectId).catch(() => ({ buildStart: null, buildComplete: null })),
      eto.getProjectCosting(projectId).catch(() => null),
      eto.getSpecCosting(projectId).catch(() => []),
    ]);

    if (!specs || specs.length === 0) {
      return res.status(404).json({
        error: `No specs found for project ${projectId} in ETO.`,
      });
    }

    const poIndex = buildPoIndex(poRows);

    const specReportsRaw = await Promise.all(specs.map(async (spec) => {
      const [topNode, bomRows] = await Promise.all([
        eto.getTopNode(projectId, spec.SpecID),
        eto.getBomRows(projectId, spec.SpecID),
      ]);

      if (!topNode || bomRows.length === 0) return null;

      const { assemblyIds, childrenMap } = buildTree(bomRows);
      const summary = buildReadinessSummary(
        topNode.TopItemID, topNode.TopPN, topNode.TopDesc,
        childrenMap, assemblyIds, poIndex
      );
      const noPoParts = findNoPoParts(bomRows, assemblyIds);

      return {
        specId:     spec.SpecID,
        specName:   spec.SDescription,
        specQty:    spec.SQuantity,
        topPN:      topNode.TopPN,
        topDesc:    topNode.TopDesc,
        machines:   summary.machines,
        tree:       summary.tree,
        noPoParts,
        totalParts: bomRows.filter(r => !assemblyIds.has(r.ChildID)).length,
      };
    }));

    const specReports = specReportsRaw.filter(Boolean);

    // Global dedup of noPoParts across specs
    const seenNoPo = new Set();
    specReports.forEach(s => {
      s.noPoParts = s.noPoParts.filter(p => {
        if (seenNoPo.has(p.id)) return false;
        seenNoPo.add(p.id);
        return true;
      });
    });

    const poActions = buildPoActionList(poRows);

    res.json({
      project,
      specs: specReports,
      poActions,
      buildDates,
      projectCosting,
      specCosting,
      demoMode: false,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error building readiness report:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
