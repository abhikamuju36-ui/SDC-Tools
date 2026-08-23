const express = require('express');
const controller = require('../controllers/assemblies.controller');

const router = express.Router();

// Static GET routes — must be defined before /:partno
router.get('/meta',       (req, res) => controller.getMeta(req, res));
router.get('/categories', (req, res) => controller.getCategories(req, res));
router.get('/jobs',       (req, res) => controller.getJobs(req, res));
router.get('/libraries',  (req, res) => controller.getLibraries(req, res));
router.get('/open',       (req, res) => controller.openFile(req, res));
router.get('/status',     (req, res) => controller.getStatus(req, res));
router.get('/counts',     (req, res) => controller.getCounts(req, res));


router.get('/export',     (req, res) => controller.exportCsv(req, res));

// Collection routes
router.get('/',           (req, res) => {
    try {
        controller.getAll(req, res);
    } catch (err) {
        console.error('CRITICAL: Assemblies getAll failed:', err);
        res.status(500).json({ error: 'Search failed', detail: err.message });
    }
});
router.post('/',          (req, res) => controller.create(req, res));
router.patch('/',         (req, res) => controller.bulkUpdate(req, res));
router.delete('/',        (req, res) => controller.bulkDelete(req, res));

// Single-record routes
router.get('/:partno/history',       (req, res) => controller.getHistory(req, res));
router.patch('/:partno/archive',     (req, res) => controller.archiveOne(req, res));
router.patch('/:partno/restore',     (req, res) => controller.restoreOne(req, res));
router.patch('/:partno',             (req, res) => controller.update(req, res));
router.delete('/:partno',            (req, res) => controller.deleteOne(req, res));

module.exports = router;
