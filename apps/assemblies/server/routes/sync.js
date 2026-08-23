/**
 * sync.js (Routes)
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/sync.controller');

router.get('/status', (req, res) => {
    try { controller.getStatus(req, res); } catch (err) {
        console.error('Sync status route error:', err);
        res.status(500).json({ error: 'Sync status unavailable', detail: err.message });
    }
});
router.post('/start', (req, res) => {
    try { controller.startSync(req, res); } catch (err) {
        console.error('Sync start route error:', err);
        res.status(500).json({ error: 'Failed to start sync', detail: err.message });
    }
});
router.get('/history', (req, res) => {
    try { controller.getHistory(req, res); } catch (err) {
        console.error('Sync history route error:', err);
        res.status(500).json({ error: 'Sync history unavailable', detail: err.message });
    }
});

module.exports = router;
