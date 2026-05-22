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


// Cached sheets list — fetched once per server process to avoid repeated list calls
let _sheetsCachePromise = null;

async function getSheetsList() {
  if (!_sheetsCachePromise) {
    _sheetsCachePromise = smartsheetFetch('/sheets?pageSize=300&includeAll=false')
      .then(data => (data && data.data ? data.data : []))
      .catch(() => []);
  }
  return _sheetsCachePromise;
}

async function findScheduleSheet(projectId) {
  const sheets = await getSheetsList();
  if (sheets.length === 0) return null;

  const pid = projectId.toString();
  // Sheets at SDC are named: "<projectId>[ -_]<description>", e.g. "1101- Coil Staker Schedule"
  // Match sheets that begin with the project ID followed by a non-digit separator
  const prefixRe = new RegExp('^' + pid + '[\\s\\-_]', 'i');
  const match =
    sheets.find(s => prefixRe.test(s.name)) ||            // "1101- ..."
    sheets.find(s => s.name.includes(pid));                // fallback: anywhere in name

  return match ? { id: match.id, name: match.name } : null;
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
    const health    = cell[cols.health]?.displayValue || cell[cols.health]?.value || 'Green';
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
    if (!buildStart && (tl.includes('project start') || tl.includes('build start') || tl.includes('builder 1')) && startVal)
      buildStart = startVal;
    if (tl.includes('ship') && finishVal) {
      // take the latest ship date across all ship milestones
      if (!buildComplete || new Date(finishVal) > new Date(buildComplete)) buildComplete = finishVal;
    }
    if (!buildComplete && (tl.includes('build complete')) && finishVal)
      buildComplete = finishVal;

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

module.exports = { getBuildDates };
