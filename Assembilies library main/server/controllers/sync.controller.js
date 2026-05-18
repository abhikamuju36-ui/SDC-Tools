/**
 * sync.controller.js
 */

const syncService = require('../services/sync.service');

class SyncController {
    getStatus(req, res) {
        try {
            const status = syncService.getStatus();
            res.json(status);
        } catch (err) {
            console.error('Failed to get sync status:', err);
            res.status(500).json({ error: 'Sync status unavailable' });
        }
    }

    async startSync(req, res) {
        const status = syncService.getStatus();
        if (status.running) {
            return res.status(400).json({ error: 'Sync already running' });
        }

        // runSync() sets status.running = true synchronously before its first await,
        // so subsequent /status polls will immediately see running: true.
        syncService.runSync().catch(err => console.error('Unhandled sync error:', err));

        res.json({ message: 'Sync started' });
    }
}

module.exports = new SyncController();
