const express = require('express');
const router = express.Router();
const eto = require('../services/eto');
const demo = require('../services/demoData');
const { buildTree, buildNestedTree } = require('../lib/bomTree');

function db() { return demo.isDemoMode() ? demo : eto; }

// GET /api/bom/:projectId/specs
router.get('/:projectId/specs', async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const src = db();
    const [project, specs] = await Promise.all([
      src.getProjectInfo(projectId),
      src.getSpecs(projectId),
    ]);
    res.json({ project, specs });
  } catch (err) {
    console.error('Error fetching specs:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bom/:projectId/:specId/tree
router.get('/:projectId/:specId/tree', async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const specId = parseInt(req.params.specId);

    const [topNode, bomRows] = await Promise.all([
      db().getTopNode(projectId, specId),
      db().getBomRows(projectId, specId),
    ]);

    if (!topNode) {
      return res.json({ tree: null, message: 'No top node found for this spec' });
    }

    const { assemblyIds, childrenMap } = buildTree(bomRows);
    const tree = buildNestedTree(topNode.TopItemID, topNode.TopPN, topNode.TopDesc, childrenMap, assemblyIds);

    res.json({ tree, topNode, rowCount: bomRows.length });
  } catch (err) {
    console.error('Error fetching BOM tree:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bom/:projectId/:specId/flat
router.get('/:projectId/:specId/flat', async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const specId = parseInt(req.params.specId);
    const bomRows = await db().getBomRows(projectId, specId);
    res.json({ rows: bomRows });
  } catch (err) {
    console.error('Error fetching BOM rows:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
