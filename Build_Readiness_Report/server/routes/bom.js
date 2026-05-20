const express = require('express');
const router  = express.Router();
const azure   = require('../azureDb');
const azureData = require('../services/azureData');
const eto       = require('../services/eto');
const demo    = require('../services/demoData');
const { buildTree, buildNestedTree } = require('../lib/bomTree');

// Shared ETO availability cache (synced with readiness.js via module-level state in eto.js)
let _etoAvailable = null;
let _etoCheckedAt = 0;
const ETO_CHECK_TTL = 60_000;

async function db() {
  const now = Date.now();
  if (_etoAvailable === null || (now - _etoCheckedAt) > ETO_CHECK_TTL) {
    try {
      await eto.getPool();
      _etoAvailable = true;
    } catch {
      _etoAvailable = false;
    }
    _etoCheckedAt = now;
  }
  if (_etoAvailable)       return eto;
  if (azure.isAvailable()) return azureData;
  return demo;
}

// GET /api/bom/:projectId/specs
router.get('/:projectId/specs', async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId, 10);
    if (isNaN(projectId) || projectId <= 0) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }
    const src = await db();
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
    const projectId = parseInt(req.params.projectId, 10);
    const specId    = parseInt(req.params.specId, 10);
    if (isNaN(projectId) || projectId <= 0) return res.status(400).json({ error: 'Invalid project ID' });
    if (isNaN(specId)    || specId    <= 0) return res.status(400).json({ error: 'Invalid spec ID' });

    const src = await db();
    const [topNode, bomRows] = await Promise.all([
      src.getTopNode(projectId, specId),
      src.getBomRows(projectId, specId),
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
    const src = await db();
    const bomRows = await src.getBomRows(projectId, specId);
    res.json({ rows: bomRows });
  } catch (err) {
    console.error('Error fetching BOM rows:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bom/projects — list all projects
router.get('/projects', async (req, res) => {
  try {
    const src = await db();
    if (src === demo) {
      return res.json({ projects: demo.getCachedProjects().map(id => ({ ProjectID: id })) });
    }
    if (src === eto) {
      // ETO doesn't have a listProjects — fall through to Azure or demo list
      if (azure.isAvailable()) {
        const projects = await azureData.listProjects();
        return res.json({ projects });
      }
      return res.json({ projects: demo.getCachedProjects().map(id => ({ ProjectID: id })) });
    }
    const projects = await azureData.listProjects();
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
