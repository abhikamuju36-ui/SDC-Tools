const express = require('express');
const router  = express.Router();
const eto     = require('../services/eto');
const { buildTree, buildNestedTree } = require('../lib/bomTree');

async function requireEto(res) {
  try {
    await eto.getPool();
    return true;
  } catch (err) {
    res.status(503).json({
      error: 'ETO database is not reachable. Check that you are on the company network and ETO SQL Server is running.',
      detail: err.message,
    });
    return false;
  }
}

// GET /api/bom/:projectId/specs
router.get('/:projectId/specs', async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId, 10);
    if (isNaN(projectId) || projectId <= 0) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }
    if (!await requireEto(res)) return;
    const [project, specs] = await Promise.all([
      eto.getProjectInfo(projectId),
      eto.getSpecs(projectId),
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
    const projectId = parseInt(req.params.projectId, 10);
    const specId    = parseInt(req.params.specId, 10);
    if (isNaN(projectId) || projectId <= 0) return res.status(400).json({ error: 'Invalid project ID' });
    if (isNaN(specId)    || specId    <= 0) return res.status(400).json({ error: 'Invalid spec ID' });
    if (!await requireEto(res)) return;

    const [topNode, bomRows] = await Promise.all([
      eto.getTopNode(projectId, specId),
      eto.getBomRows(projectId, specId),
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
    const projectId = parseInt(req.params.projectId, 10);
    const specId    = parseInt(req.params.specId, 10);
    if (isNaN(projectId) || projectId <= 0) return res.status(400).json({ error: 'Invalid project ID' });
    if (isNaN(specId)    || specId    <= 0) return res.status(400).json({ error: 'Invalid spec ID' });
    if (!await requireEto(res)) return;
    const bomRows = await eto.getBomRows(projectId, specId);
    res.json({ rows: bomRows });
  } catch (err) {
    console.error('Error fetching BOM rows:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bom/projects — not supported via ETO (no list-all-projects query)
router.get('/projects', async (req, res) => {
  res.status(501).json({ error: 'Project listing is not available via ETO. Enter a project ID directly.' });
});

module.exports = router;
