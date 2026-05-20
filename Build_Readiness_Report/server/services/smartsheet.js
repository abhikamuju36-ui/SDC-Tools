/**
 * Smartsheet integration — upgraded to pull full schedule data:
 * hierarchy, milestones, predecessors, assignees, critical path.
 */

const API_BASE = 'https://api.smartsheet.com/2.0';

async function smartsheetFetch(path) {
  const apiKey = process.env.SMARTSHEET_API_KEY;
  if (!apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) { console.error(`Smartsheet API error: ${res.status} ${res.statusText}`); return null; }
    return res.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}


// Sheet ID cache — avoids re-listing all sheets on every request
const _sheetIdCache = {};

async function findScheduleSheet(projectId) {
  if (_sheetIdCache[projectId]) return _sheetIdCache[projectId];

  // List all accessible sheets and match by project ID in the name.
  // The /search endpoint requires a plan upgrade (returns error 4000), so we
  // use /sheets?includeAll=true instead, which works on all plan levels.
  const data = await smartsheetFetch('/sheets?includeAll=true');
  if (!data?.data) return null;

  const pid = String(projectId);
  const sheets = data.data;

  // Priority 1: exact project ID + "schedule" in name
  let match = sheets.find(s => s.name.includes(pid) && s.name.toLowerCase().includes('schedule'));
  // Priority 2: project ID anywhere in name (handles "1129_Schneider..." style names)
  if (!match) match = sheets.find(s => s.name.includes(pid));

  const result = match ? { id: match.id, name: match.name } : null;
  if (result) _sheetIdCache[projectId] = result;
  return result;
}

async function getBuildDates(projectId) {
  const sheetInfo = await findScheduleSheet(projectId);
  if (!sheetInfo) return { buildStart: null, buildComplete: null, milestones: [], tasks: [], permalink: null, source: null };

  const sheet = await smartsheetFetch(`/sheets/${sheetInfo.id}?include=columnType`);
  if (!sheet?.rows) return { buildStart: null, buildComplete: null, milestones: [], tasks: [], permalink: null, source: null };

  // ── Detect columns by name + type ────────────────────────────────────
  const cols = {};
  (sheet.columns || []).forEach(c => {
    const name = (c.title || '').toLowerCase().trim();
    const type = (c.type || '').toUpperCase();
    if (!cols.taskName && (name === 'task name' || name === 'name' || name === 'task')) cols.taskName = c.id;
    if (!cols.start && name.includes('start') && !name.includes('baseline')) cols.start = c.id;
    if (!cols.finish && (name.includes('finish') || name.includes('end')) && !name.includes('baseline')) cols.finish = c.id;
    if (!cols.percent && (name.includes('% complete') || name.includes('complete') || type === 'PERCENT_COMPLETE')) cols.percent = c.id;
    if (!cols.health && (name.includes('health') || name.includes('status') || name.includes('flag'))) cols.health = c.id;
    if (!cols.predecessor && (type === 'PREDECESSOR' || name.includes('predecessor'))) cols.predecessor = c.id;
    if (!cols.duration && (type === 'DURATION' || name === 'duration')) cols.duration = c.id;
    if (!cols.assignee && (type === 'CONTACT_LIST' || type === 'MULTI_CONTACT_LIST' || name.includes('assign') || name.includes('owner'))) cols.assignee = c.id;
  });

  // ── Build row lookup maps ─────────────────────────────────────────────
  const rowMap = {};
  const rowNumMap = {}; // rowNumber → rowId
  (sheet.rows || []).forEach(row => {
    rowMap[row.id] = row;
    if (row.rowNumber) rowNumMap[row.rowNumber] = row.id;
  });

  // Which rows have children (are summary/parent rows)
  const parentIdSet = new Set((sheet.rows || []).map(r => r.parentId).filter(Boolean));

  // Indent level from parentId chain
  function getIndentLevel(row) {
    let level = 0, cur = row;
    const seen = new Set();
    while (cur.parentId && rowMap[cur.parentId] && !seen.has(cur.id)) {
      seen.add(cur.id); level++; cur = rowMap[cur.parentId];
    }
    return level;
  }

  // ── Parse rows ────────────────────────────────────────────────────────
  let buildStart = null, buildComplete = null;
  const tasks = [];

  (sheet.rows || []).forEach(row => {
    const cell = {};
    (row.cells || []).forEach(c => { cell[c.columnId] = c; });

    const taskName = (cell[cols.taskName]?.value || '').toString().trim();
    if (!taskName) return;

    const startVal  = cell[cols.start]?.value  || null;
    const finishVal = cell[cols.finish]?.value || null;
    const pct       = typeof cell[cols.percent]?.value === 'number' ? cell[cols.percent].value : 0;
    const health    = String(cell[cols.health]?.displayValue || cell[cols.health]?.value || 'Green');
    const durVal    = cell[cols.duration]?.value;

    // Assignee
    let assignee = '';
    const ac = cell[cols.assignee];
    if (ac) {
      assignee = ac.displayValue || ac.objectValue?.name || ac.objectValue?.email || (typeof ac.value === 'string' ? ac.value : '') || '';
    }

    // Predecessor IDs
    let predecessorIds = [];
    const pc = cell[cols.predecessor];
    if (pc?.objectValue?.predecessors) {
      predecessorIds = pc.objectValue.predecessors
        .map(p => p.rowId || rowNumMap[p.rowNumber]).filter(Boolean);
    } else if (pc?.displayValue) {
      const nums = pc.displayValue.match(/\d+/g) || [];
      predecessorIds = nums.map(n => rowNumMap[parseInt(n)]).filter(Boolean);
    }

    // Milestone detection: zero duration or same start/finish
    const dur = durVal !== null && durVal !== undefined ? parseFloat(durVal) : null;
    const isMilestone = dur === 0 || (startVal && finishVal && startVal === finishVal);
    const isSummary   = parentIdSet.has(row.id);
    const indentLevel = getIndentLevel(row);

    const tl = taskName.toLowerCase();
    if ((tl.includes('builder 1') || tl.includes('build start')) && startVal) buildStart = startVal;
    if ((tl.includes('build complete') || tl.includes('ship machine')) && !buildComplete && finishVal) buildComplete = finishVal;

    tasks.push({
      id: row.id, rowNumber: row.rowNumber, name: taskName,
      percent: pct, health, start: startVal, finish: finishVal,
      duration: dur, assignee, predecessorIds,
      predecessorDisplay: pc?.displayValue || '',
      isMilestone, isSummary, indentLevel,
      parentId: row.parentId || null,
      onCritical: false,
    });
  });

  // ── Critical path: backward walk from latest-finish leaf task ─────────
  const taskById = {};
  tasks.forEach(t => { taskById[t.id] = t; });
  const leaves = tasks.filter(t => !t.isSummary && t.finish);
  if (leaves.length > 0) {
    const sink = leaves.reduce((a, b) => new Date(a.finish) >= new Date(b.finish) ? a : b);
    const visited = new Set();
    const queue = [sink.id];
    while (queue.length > 0) {
      const id = queue.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      const t = taskById[id];
      if (!t) continue;
      t.onCritical = true;
      (t.predecessorIds || []).forEach(pid => queue.push(pid));
    }
  }

  const milestones = tasks.filter(t => t.isMilestone).map(t => ({
    id: t.id, name: t.name, percent: t.percent, health: t.health,
    start: t.start, finish: t.finish,
  }));

  return {
    sheetId: sheet.id, startColId: cols.start, finishColId: cols.finish,
    buildStart, buildComplete, milestones, tasks,
    permalink: sheet.permalink, source: sheet.name,
  };
}

module.exports = { getBuildDates, findScheduleSheet };
