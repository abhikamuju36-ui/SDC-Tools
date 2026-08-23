'use strict';

// Read-only client for the SDC Scheduler app's server-to-server integration
// API (/api/integration/project-dates/:jobNumber). Replaces the removed
// Smartsheet integration as the source of a project's build-start/ship dates.
//
// Mirrors SDC_Scheduler/lib/plannerClient.js's own optional-integration
// contract: CONFIGURED is false unless both env vars are set, and the one
// function throws a clear "not configured" error when it isn't — so this
// stays dormant and harmless until SCHEDULER_URL + the shared token are set.
//
// Env:
//   SCHEDULER_URL           base URL of the SDC Scheduler app, e.g. http://localhost:4003
//   READINESS_SHARED_TOKEN  bearer token; MUST match the scheduler app's own value

const BASE = (process.env.SCHEDULER_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.READINESS_SHARED_TOKEN || '';
const CONFIGURED = Boolean(BASE && TOKEN);
const TIMEOUT_MS = 8000;

/**
 * Look up build-start / ship dates for a project by its ETO ProjectID.
 * Returns { buildStart, shipDate } (either may be null) or null if the
 * scheduler has no project for this job, or if the integration isn't
 * configured. Never throws on a routine miss — callers treat this as
 * optional enrichment, same as the Smartsheet lookup it replaces.
 */
async function getProjectDates(jobNumber) {
  if (!CONFIGURED) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/api/integration/project-dates/${encodeURIComponent(jobNumber)}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
      signal: ctrl.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Scheduler returned ${res.status}`);
    const data = await res.json();
    return { buildStart: data.buildStart || null, shipDate: data.shipDate || null };
  } catch (e) {
    console.error('[scheduler] project-dates lookup failed:', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { CONFIGURED, getProjectDates };
