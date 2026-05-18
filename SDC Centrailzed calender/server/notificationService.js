const sqlite = require('./sqlite');
const https  = require('https');
const http   = require('http');

function postTeamsWebhook(webhookUrl, payload) {
  try {
    const body    = JSON.stringify(payload);
    const url     = new URL(webhookUrl);
    const client  = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = client.request(opts, res => {
      res.resume();
      res.on('end', () => console.log(`[Notification] Teams webhook sent (HTTP ${res.statusCode})`));
    });
    req.on('error', e => console.error('[Notification] Teams webhook failed:', e.message));
    req.write(body);
    req.end();
  } catch (e) {
    console.error('[Notification] Teams webhook error:', e.message);
  }
}

const checkInterval = 60 * 1000; // Check every 60 seconds
let timerId = null;

const processedAlerts = new Set();
// Prune daily so the Set doesn't grow unbounded over weeks of uptime
setInterval(() => processedAlerts.clear(), 24 * 60 * 60 * 1000);

async function scanAndNotify() {
  try {
    const now = new Date();
    const events = await sqlite.getAllEvents();
    
    for (const ev of events) {
      if (!ev.approved) continue;
      
      // Determine event time
      let eventDate;
      if (ev.allDay || !ev.time) {
        eventDate = new Date(ev.date + 'T00:00:00');
      } else {
        eventDate = new Date(ev.date + 'T' + ev.time + ':00');
      }

      const timeDiffMs = eventDate - now;
      const diffMins = Math.round(timeDiffMs / (60 * 1000));

      // If event is happening in exactly 15 minutes (or between 10 and 20 mins)
      if (diffMins > 0 && diffMins <= 15) {
        const alertKey = `${ev.id}_15min`;
        
        if (!processedAlerts.has(alertKey)) {
          processedAlerts.add(alertKey);
          triggerNotification(ev, diffMins);
        }
      }
    }
  } catch (err) {
    console.error('[Notification Service Error]', err.message);
  }
}

function triggerNotification(ev, minsRemaining) {
  const teamsWebhook = (process.env.TEAMS_WEBHOOK_URL || '').trim();

  console.log('');
  console.log('======================================================');
  console.log(`🔔 AUTOMATED REMINDER: "${ev.title}"`);
  console.log(`⏰ Starting in ${minsRemaining} minutes.`);
  console.log(`📁 Category: ${ev.category.toUpperCase()}`);
  if (ev.location) console.log(`📍 Location: ${ev.location}`);
  console.log('======================================================');
  console.log('');

  // If Teams Webhook configured, execute dispatch
  if (teamsWebhook.startsWith('http')) {
    const payload = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      "themeColor": "0076D7",
      "summary": `Reminder: ${ev.title}`,
      "sections": [{
        "activityTitle": `🔔 Calendar Reminder: ${ev.title}`,
        "activitySubtitle": `Starting in ${minsRemaining} minutes`,
        "facts": [
          { "name": "Category", "value": ev.category },
          { "name": "Time", "value": ev.time || 'All Day' },
          { "name": "Location", "value": ev.location || 'N/A' }
        ],
        "markdown": true
      }]
    };

    postTeamsWebhook(teamsWebhook, payload);
  }
}

const NotificationService = {
  start: () => {
    if (timerId) return;
    console.log('🚀 Automated Notification service initialized.');
    timerId = setInterval(scanAndNotify, checkInterval);
    // Run once immediately on start
    scanAndNotify();
  },
  stop: () => {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }
};

module.exports = NotificationService;
