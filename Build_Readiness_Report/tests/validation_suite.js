/**
 * Data Validation Suite
 *
 * Validates that every transformation layer — bomTree.js, the readiness pipeline,
 * and the frontend mapping in app.jsx — produces internally consistent data and
 * that what the frontend displays matches what the backend computed.
 *
 * Run: node tests/validation_suite.js
 */

'use strict';
const assert = require('assert');

// ─── Modules under test ──────────────────────────────────────────────────────
const {
  buildTree, getLeafParts, getAssemblyStats,
  buildNestedTree, buildReadinessSummary,
  buildPoActionList, buildPoIndex, findNoPoParts,
} = require('../server/lib/bomTree');
const demo = require('../server/services/demoData');

// ─── Minimal test runner ─────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
    passed++;
  } catch (e) {
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[33m→ ${e.message}\x1b[0m\n`);
    failures.push({ name, message: e.message });
    failed++;
  }
}

function section(title) {
  process.stdout.write(`\n\x1b[1m── ${title}\x1b[0m\n`);
}

function eq(a, b, msg) {
  assert.strictEqual(a, b, msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function ok(v, msg) { assert.ok(v, msg); }
function notOk(v, msg) { assert.ok(!v, msg); }

// ─── Simulates the frontend mapping from app.jsx ─────────────────────────────
function frontendMap(raw) {
  const mapped = {
    job: {
      id: raw.project.ProjectID,
      name: raw.project.ProjectName,
      buildStart: raw.buildDates?.buildStart || null,
      shipDate: raw.buildDates?.buildComplete || null,
      kpis: { assemblies: 0, ready: 0, close: 0, blocked: 0, noPO: 0 },
      actMat: raw.projectCosting?.ActMaterials || 0,
      estMat: (raw.projectCosting?.EstMaterials > 1000) ? raw.projectCosting.EstMaterials : null,
      actLabor: ((raw.projectCosting?.ActEngLabor || 0) + (raw.projectCosting?.ActMfgLabor || 0)) || null,
      estLabor: ((raw.projectCosting?.EstEngLabor || 0) + (raw.projectCosting?.EstMfgLabor || 0)) || null,
      actEngHrs: raw.projectCosting?.ActEngHrs || 0,
      actMfgHrs: raw.projectCosting?.ActMfgHrs || 0,
      estEngHrs: raw.projectCosting?.EstEngHrs || 0,
      estMfgHrs: raw.projectCosting?.EstMfgHrs || 0,
      marginActual: raw.projectCosting?.ActualMargin != null ? raw.projectCosting.ActualMargin / 100 : null,
      marginTarget: (raw.projectCosting?.BudgetMargin > 0) ? raw.projectCosting.BudgetMargin / 100 : null,
    },
    readiness: raw.specs.map(s => ({
      spec: s.specId,
      title: s.specName,
      lines: s.totalParts,
      assemblies: (s.machines || []).map(machine => ({
        ...machine,
        code: machine.pn,
        name: machine.pn,
        desc: machine.desc,
        pct: machine.stats?.pct || 0,
        ready: machine.stats?.received || 0,
        total: machine.stats?.total || 0,
        noPo: machine.stats?.noPO || 0,
        status: (machine.stats?.pct >= 85) ? 'ready' : (machine.stats?.pct >= 60) ? 'close' : 'blocked',
        children: [],
      }))
    })),
    costing: (raw.specCosting || []).map(s => ({
      spec: String(s.SectionID),
      name: s.SectionName,
      laborHrs: (s.EngHours || 0) + (s.MfgHours || 0),
      labor: (s.EngLabor || 0) + (s.MfgLabor || 0),
      materials: s.TotalMaterials || 0,
      total: s.TotalCost || 0,
      margin: s.Margin || 0,
    })),
    poActions: raw.poActions,
    nopo: raw.specs.flatMap(s => (s.noPoParts || []).map(p => ({
      ...p,
      parent: (p.parentPN ? `${p.parentPN} ` : '') + (p.parentDesc || p.parentPN || 'Loose Parts'),
    })))
  };

  mapped.readiness.forEach(s => {
    s.assemblies.forEach(a => {
      mapped.job.kpis.assemblies++;
      if (a.status === 'ready')        mapped.job.kpis.ready++;
      else if (a.status === 'close')   mapped.job.kpis.close++;
      else                             mapped.job.kpis.blocked++;
    });
  });
  mapped.job.kpis.noPO = mapped.nopo.length;
  return mapped;
}

// ─── Run full pipeline (mirrors readiness route) ─────────────────────────────
async function runPipeline(projectId, allBomData, allPoRows) {
  const project        = await demo.getProjectInfo(projectId);
  const specs          = await demo.getSpecs(projectId);
  const poRows         = allPoRows[projectId];
  const poIndex        = buildPoIndex(poRows);
  const poActions      = buildPoActionList(poRows);
  const projectCosting = await demo.getProjectCosting(projectId).catch(() => null);
  const specCosting    = await demo.getSpecCosting(projectId).catch(() => []);

  const specReports = await Promise.all(specs.map(async spec => {
    const topNode = await demo.getTopNode(projectId, spec.SpecID);
    const bomRows = allBomData[`${projectId}_${spec.SpecID}`];
    if (!topNode || !bomRows || bomRows.length === 0) return null;
    const { assemblyIds, childrenMap } = buildTree(bomRows);
    const summary = buildReadinessSummary(
      topNode.TopItemID, topNode.TopPN, topNode.TopDesc,
      childrenMap, assemblyIds, poIndex
    );
    const noPoParts = findNoPoParts(bomRows, assemblyIds);
    return {
      specId: spec.SpecID,
      specName: spec.SDescription,
      specQty: spec.SQuantity,
      topPN: topNode.TopPN,
      topDesc: topNode.TopDesc,
      machines: summary.machines,
      tree: summary.tree,
      noPoParts,
      totalParts: bomRows.length,
    };
  }));

  const filtered = specReports.filter(Boolean);

  // Mirror the route: globally deduplicate noPoParts across specs
  const seenNoPo = new Set();
  filtered.forEach(s => {
    s.noPoParts = s.noPoParts.filter(p => {
      if (seenNoPo.has(p.id)) return false;
      seenNoPo.add(p.id);
      return true;
    });
  });

  return {
    project, specs: filtered, poActions,
    buildDates: { buildStart: null, buildComplete: null },
    projectCosting, specCosting, demoMode: true,
  };
}

// ─── Smartsheet service unit tests ───────────────────────────────────────────
function runSmartsheetUnitTests() {
  section('11 · Smartsheet service — column detection and task logic');

  // ── Helper: simulate the column detection logic ──
  function detectColumns(columns) {
    const cols = {};
    columns.forEach(c => {
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
    return cols;
  }

  test('colDetect: finds taskName by title "Task Name"', () => {
    const cols = detectColumns([{ id: 1, title: 'Task Name', type: 'TEXT_NUMBER' }]);
    eq(cols.taskName, 1, 'taskName not detected');
  });

  test('colDetect: finds start by "Start Date" (not baseline)', () => {
    const cols = detectColumns([
      { id: 1, title: 'Baseline Start', type: 'DATE' },
      { id: 2, title: 'Start Date', type: 'DATE' },
    ]);
    eq(cols.start, 2, 'should pick Start Date, not Baseline Start');
  });

  test('colDetect: finds finish by "Finish" title', () => {
    const cols = detectColumns([{ id: 5, title: 'Finish', type: 'DATE' }]);
    eq(cols.finish, 5, 'finish not detected by title');
  });

  test('colDetect: finds finish by "End Date" title', () => {
    const cols = detectColumns([{ id: 6, title: 'End Date', type: 'DATE' }]);
    eq(cols.finish, 6, 'finish not detected from "End Date"');
  });

  test('colDetect: ignores "Baseline Finish"', () => {
    const cols = detectColumns([
      { id: 7, title: 'Baseline Finish', type: 'DATE' },
      { id: 8, title: 'Finish', type: 'DATE' },
    ]);
    eq(cols.finish, 8, 'should skip Baseline Finish');
  });

  test('colDetect: finds percent by PERCENT_COMPLETE type', () => {
    const cols = detectColumns([{ id: 10, title: 'Pct', type: 'PERCENT_COMPLETE' }]);
    eq(cols.percent, 10, 'percent not detected by type');
  });

  test('colDetect: finds predecessor by PREDECESSOR type', () => {
    const cols = detectColumns([{ id: 11, title: 'Depends On', type: 'PREDECESSOR' }]);
    eq(cols.predecessor, 11, 'predecessor not detected by type');
  });

  test('colDetect: finds assignee by CONTACT_LIST type', () => {
    const cols = detectColumns([{ id: 12, title: 'Owner', type: 'CONTACT_LIST' }]);
    eq(cols.assignee, 12, 'assignee not detected by CONTACT_LIST type');
  });

  test('colDetect: finds assignee by "Assigned To" title', () => {
    const cols = detectColumns([{ id: 13, title: 'Assigned To', type: 'TEXT_NUMBER' }]);
    eq(cols.assignee, 13, 'assignee not detected by title');
  });

  test('colDetect: first match wins (no overwrite)', () => {
    const cols = detectColumns([
      { id: 20, title: 'Task Name', type: 'TEXT_NUMBER' },
      { id: 21, title: 'Name', type: 'TEXT_NUMBER' },
    ]);
    eq(cols.taskName, 20, 'first taskName column should win');
  });

  // ── Milestone detection ──
  function isMilestone(dur, startVal, finishVal) {
    const d = dur !== null && dur !== undefined ? parseFloat(dur) : null;
    return d === 0 || (startVal && finishVal && startVal === finishVal);
  }

  test('milestone: duration=0 is a milestone', () => {
    ok(isMilestone(0, '2025-01-01', '2025-01-05'), 'dur=0 should be milestone');
  });

  test('milestone: start===finish is a milestone', () => {
    ok(isMilestone(1, '2025-06-15', '2025-06-15'), 'same start/finish should be milestone');
  });

  test('milestone: different start/finish with dur>0 is NOT a milestone', () => {
    notOk(isMilestone(3, '2025-01-01', '2025-01-04'), 'dur>0 with different dates should not be milestone');
  });

  test('milestone: null duration with different dates is NOT a milestone', () => {
    notOk(isMilestone(null, '2025-01-01', '2025-01-10'), 'null dur, different dates → not milestone');
  });

  // ── Indent level computation ──
  function getIndentLevel(rowId, rowMap) {
    let level = 0, cur = rowMap[rowId];
    const seen = new Set();
    while (cur && cur.parentId && rowMap[cur.parentId] && !seen.has(cur.id)) {
      seen.add(cur.id); level++; cur = rowMap[cur.parentId];
    }
    return level;
  }

  test('indentLevel: root row (no parentId) has level 0', () => {
    const rowMap = { 100: { id: 100, parentId: null } };
    eq(getIndentLevel(100, rowMap), 0, 'root should be level 0');
  });

  test('indentLevel: one-deep child has level 1', () => {
    const rowMap = {
      100: { id: 100, parentId: null },
      101: { id: 101, parentId: 100 },
    };
    eq(getIndentLevel(101, rowMap), 1, 'direct child should be level 1');
  });

  test('indentLevel: two-deep child has level 2', () => {
    const rowMap = {
      100: { id: 100, parentId: null },
      101: { id: 101, parentId: 100 },
      102: { id: 102, parentId: 101 },
    };
    eq(getIndentLevel(102, rowMap), 2, 'grandchild should be level 2');
  });

  // ── Summary row detection ──
  test('summaryRow: row whose id appears as parentId of any row is a summary', () => {
    const rows = [
      { id: 10, parentId: null },
      { id: 11, parentId: 10 },
      { id: 12, parentId: 10 },
    ];
    const parentIdSet = new Set(rows.map(r => r.parentId).filter(Boolean));
    ok(parentIdSet.has(10), 'row 10 should be a summary (it is a parent)');
    notOk(parentIdSet.has(11), 'row 11 should not be a summary');
    notOk(parentIdSet.has(12), 'row 12 should not be a summary');
  });

  // ── Critical path BFS ──
  function computeCriticalPath(tasks) {
    const taskById = {};
    tasks.forEach(t => { taskById[t.id] = t; t.onCritical = false; });
    const leaves = tasks.filter(t => !t.isSummary && t.finish);
    if (leaves.length === 0) return tasks;
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
    return tasks;
  }

  test('criticalPath: latest-finish leaf always marked onCritical', () => {
    const tasks = [
      { id: 1, name: 'A', start: '2025-01-01', finish: '2025-01-10', isSummary: false, predecessorIds: [] },
      { id: 2, name: 'B', start: '2025-01-05', finish: '2025-01-20', isSummary: false, predecessorIds: [1] },
      { id: 3, name: 'C', start: '2025-01-01', finish: '2025-01-08', isSummary: false, predecessorIds: [] },
    ];
    computeCriticalPath(tasks);
    ok(tasks.find(t => t.id === 2).onCritical, 'task B (latest finish) should be on critical path');
  });

  test('criticalPath: predecessor of latest leaf is also marked', () => {
    const tasks = [
      { id: 1, name: 'A', start: '2025-01-01', finish: '2025-01-10', isSummary: false, predecessorIds: [] },
      { id: 2, name: 'B', start: '2025-01-10', finish: '2025-01-20', isSummary: false, predecessorIds: [1] },
    ];
    computeCriticalPath(tasks);
    ok(tasks.find(t => t.id === 1).onCritical, 'task A (predecessor of B) should be on critical path');
  });

  test('criticalPath: non-predecessor leaf NOT on critical path', () => {
    const tasks = [
      { id: 1, name: 'A', start: '2025-01-01', finish: '2025-01-10', isSummary: false, predecessorIds: [] },
      { id: 2, name: 'B', start: '2025-01-10', finish: '2025-01-20', isSummary: false, predecessorIds: [1] },
      { id: 3, name: 'C', start: '2025-01-01', finish: '2025-01-05', isSummary: false, predecessorIds: [] },
    ];
    computeCriticalPath(tasks);
    notOk(tasks.find(t => t.id === 3).onCritical, 'task C is not a predecessor of the sink, should not be critical');
  });

  test('criticalPath: summary rows excluded from sink candidates', () => {
    const tasks = [
      { id: 1, name: 'Summary', start: '2025-01-01', finish: '2025-02-01', isSummary: true, predecessorIds: [] },
      { id: 2, name: 'Leaf', start: '2025-01-01', finish: '2025-01-20', isSummary: false, predecessorIds: [] },
    ];
    computeCriticalPath(tasks);
    ok(tasks.find(t => t.id === 2).onCritical, 'leaf task should be on critical path, not summary');
    notOk(tasks.find(t => t.id === 1).onCritical, 'summary row should not be selected as sink');
  });

  test('criticalPath: no tasks → nothing marked critical', () => {
    const tasks = [];
    computeCriticalPath(tasks);
    eq(tasks.length, 0, 'empty task list should produce no results');
  });

  test('criticalPath: no infinite loop on circular predecessor refs', () => {
    // Row A predecessor B, Row B predecessor A — BFS visited set prevents infinite loop
    const tasks = [
      { id: 1, name: 'A', start: '2025-01-01', finish: '2025-01-10', isSummary: false, predecessorIds: [2] },
      { id: 2, name: 'B', start: '2025-01-05', finish: '2025-01-20', isSummary: false, predecessorIds: [1] },
    ];
    // Should complete without hanging
    computeCriticalPath(tasks);
    ok(true, 'No infinite loop');
  });
}

// ─── Gantt / Timeline mapping tests ──────────────────────────────────────────
function runGanttMappingTests(poRows1083, poActions1083) {
  section('12 · Gantt row type assignment — frontend timeline mapping');

  // Simulate ganttRows logic from timeline.jsx (Smartsheet tasks path)
  function mapToGanttRows(tasks) {
    return tasks.map(t => ({
      ...t,
      type: t.isMilestone ? 'milestone' : t.isSummary ? 'summary' : 'task',
      label: t.name,
      date: (t.isMilestone && (t.finish || t.start)) ? new Date(t.finish || t.start) : null,
      colorKey: (t.health || '').toLowerCase().includes('red') ? 'threat'
              : (t.health || '').toLowerCase().includes('yellow') ? 'pending' : 'ready',
    }));
  }

  // Simulate ganttTasks PO fallback from timeline.jsx
  function buildPoFallbackTasks(allEntries) {
    const today = new Date();
    return allEntries
      .filter(e => e.po?.dueDate)
      .map(e => {
        const due = new Date(e.po.dueDate);
        const allRcvd = e.po.parts.every(p => p.received >= p.qty);
        const someRcvd = e.po.parts.some(p => p.received > 0);
        const qty   = e.po.parts.reduce((s, p) => s + p.qty, 0);
        const rcvd  = e.po.parts.reduce((s, p) => s + p.received, 0);
        const daysLeft = Math.round((due - today) / 86400000);

        let cls;
        if (allRcvd) cls = 'green';
        else if (daysLeft < 0) cls = 'red';
        else if (daysLeft <= 14) cls = 'yellow';
        else cls = 'blue';

        const start = e.po.poDate
          ? new Date(e.po.poDate)
          : new Date(due.getTime() - 14 * 86400000);

        return {
          id: e.po.poId,
          name: `${e.supplier || 'Unknown'} — PO ${e.po.poId}`,
          start: start.toISOString().slice(0, 10),
          finish: e.po.dueDate,
          percent: qty > 0 ? rcvd / qty : 0,
          health: cls === 'red' ? 'Red' : cls === 'yellow' ? 'Yellow' : cls === 'green' ? 'Received' : 'OnTrack',
          isMilestone: false, isSummary: false, onCritical: false,
        };
      })
      .sort((a, b) => new Date(a.finish) - new Date(b.finish));
  }

  const allEntries1083 = [
    ...poActions1083.critical, ...poActions1083.warning,
    ...poActions1083.onTrack,  ...poActions1083.delivered,
  ];

  const poFallback = buildPoFallbackTasks(allEntries1083);

  test('ganttRows: milestone isMilestone=true maps to type="milestone"', () => {
    const rows = mapToGanttRows([
      { id: 1, name: 'Ship Machine', isMilestone: true, isSummary: false, finish: '2025-06-01', start: '2025-06-01', health: 'Green', onCritical: false },
    ]);
    eq(rows[0].type, 'milestone', 'isMilestone should map to type=milestone');
  });

  test('ganttRows: summary row maps to type="summary"', () => {
    const rows = mapToGanttRows([
      { id: 2, name: 'Phase 1', isMilestone: false, isSummary: true, finish: '2025-07-01', start: '2025-01-01', health: 'Green', onCritical: false },
    ]);
    eq(rows[0].type, 'summary', 'isSummary should map to type=summary');
  });

  test('ganttRows: regular task maps to type="task"', () => {
    const rows = mapToGanttRows([
      { id: 3, name: 'Weld Frame', isMilestone: false, isSummary: false, finish: '2025-05-01', start: '2025-04-01', health: 'Green', onCritical: false },
    ]);
    eq(rows[0].type, 'task', 'non-milestone non-summary should map to type=task');
  });

  test('ganttRows: Red health → colorKey="threat"', () => {
    const rows = mapToGanttRows([
      { id: 4, name: 'Late Task', isMilestone: false, isSummary: false, finish: '2025-05-01', start: '2025-04-01', health: 'Red', onCritical: false },
    ]);
    eq(rows[0].colorKey, 'threat', 'Red health should be threat');
  });

  test('ganttRows: Yellow health → colorKey="pending"', () => {
    const rows = mapToGanttRows([
      { id: 5, name: 'Warning Task', isMilestone: false, isSummary: false, finish: '2025-05-01', start: '2025-04-01', health: 'Yellow', onCritical: false },
    ]);
    eq(rows[0].colorKey, 'pending', 'Yellow health should be pending');
  });

  test('ganttRows: Green health → colorKey="ready"', () => {
    const rows = mapToGanttRows([
      { id: 6, name: 'On Track', isMilestone: false, isSummary: false, finish: '2025-05-01', start: '2025-04-01', health: 'Green', onCritical: false },
    ]);
    eq(rows[0].colorKey, 'ready', 'Green health should be ready');
  });

  test('ganttRows: milestone date=finish when finish present', () => {
    const finish = '2025-06-15';
    const rows = mapToGanttRows([
      { id: 7, name: 'Done', isMilestone: true, isSummary: false, finish, start: finish, health: 'Green', onCritical: false },
    ]);
    ok(rows[0].date instanceof Date, 'milestone should have a Date object');
    eq(rows[0].date.toISOString().slice(0, 10), finish, 'milestone date should match finish');
  });

  test('ganttRows: non-milestone has date=null', () => {
    const rows = mapToGanttRows([
      { id: 8, name: 'Task', isMilestone: false, isSummary: false, finish: '2025-05-01', start: '2025-04-01', health: 'Green', onCritical: false },
    ]);
    eq(rows[0].date, null, 'non-milestone should have null date');
  });

  test('poFallback: only entries with dueDate are included', () => {
    for (const t of poFallback) {
      ok(t.finish, `PO task ${t.id} missing finish/dueDate`);
    }
  });

  test('poFallback: tasks sorted by finish ascending', () => {
    for (let i = 1; i < poFallback.length; i++) {
      const prev = new Date(poFallback[i - 1].finish);
      const curr = new Date(poFallback[i].finish);
      ok(curr >= prev, `poFallback not sorted at index ${i}: ${poFallback[i-1].finish} > ${poFallback[i].finish}`);
    }
  });

  test('poFallback: percent is between 0 and 1', () => {
    for (const t of poFallback) {
      ok(t.percent >= 0 && t.percent <= 1, `PO ${t.id} percent=${t.percent} out of [0,1]`);
    }
  });

  test('poFallback: delivered POs get health="Received"', () => {
    for (const e of poActions1083.delivered) {
      const task = poFallback.find(t => t.id === e.po.poId);
      if (!task) continue; // might not have dueDate
      eq(task.health, 'Received', `PO ${e.po.poId} is delivered but health=${task.health}`);
    }
  });

  test('poFallback: overdue active POs get health="Red"', () => {
    const today = new Date();
    for (const e of poActions1083.critical) {
      const task = poFallback.find(t => t.id === e.po.poId);
      if (!task) continue;
      const due = new Date(task.finish);
      if (due < today) {
        eq(task.health, 'Red', `PO ${e.po.poId} is overdue critical but health=${task.health}`);
      }
    }
  });

  test('poFallback: start <= finish for all tasks', () => {
    for (const t of poFallback) {
      const s = new Date(t.start), f = new Date(t.finish);
      ok(s <= f, `PO ${t.id}: start(${t.start}) > finish(${t.finish})`);
    }
  });

  test('poFallback: isMilestone/isSummary/onCritical all false', () => {
    for (const t of poFallback) {
      notOk(t.isMilestone, `PO ${t.id} should not be a milestone`);
      notOk(t.isSummary,   `PO ${t.id} should not be a summary`);
      notOk(t.onCritical,  `PO ${t.id} should not be on critical path`);
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN — async entry point
// ═════════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    // ── Pre-load all async data ───────────────────────────────────────────────
    const [
      rawBom1083_10, rawBom1083_30,
      rawBom1129_10, rawBom1129_30,
      topNode1083_10, topNode1083_30,
      topNode1129_10,
      poRows1083, poRows1129,
    ] = await Promise.all([
      demo.getBomRows(1083, 10),
      demo.getBomRows(1083, 30),
      demo.getBomRows(1129, 10),
      demo.getBomRows(1129, 30),
      demo.getTopNode(1083, 10),
      demo.getTopNode(1083, 30),
      demo.getTopNode(1129, 10),
      demo.getPoDetails(1083),
      demo.getPoDetails(1129),
    ]);

    const allBomData = {
      '1083_10': rawBom1083_10, '1083_30': rawBom1083_30,
      '1129_10': rawBom1129_10, '1129_30': rawBom1129_30,
    };
    const allPoRows = { 1083: poRows1083, 1129: poRows1129 };

    const tree1083_10 = buildTree(rawBom1083_10);
    const tree1083_30 = buildTree(rawBom1083_30);
    const tree1129_10 = buildTree(rawBom1129_10);

    const poIndex1083 = buildPoIndex(poRows1083);
    const poIndex1129 = buildPoIndex(poRows1129);

    const poActions1083 = buildPoActionList(poRows1083);
    const poActions1129 = buildPoActionList(poRows1129);

    // ═══════════════════════════════════════════════════════════════════════
    //  SECTION 1 — buildTree()
    // ═══════════════════════════════════════════════════════════════════════
    section('1 · buildTree() — deduplication and assembly identification');

    test('bom_1083_10: raw file loads with rows', () => {
      ok(rawBom1083_10.length > 0, 'BOM 1083 spec 10 should have rows');
    });

    test('bom_1083_10: deduped has no duplicate (ChildID, ParentID) pairs', () => {
      const seen = new Set();
      for (const r of tree1083_10.deduped) {
        const k = `${r.ChildID}-${r.ParentID}`;
        ok(!seen.has(k), `Duplicate pair: ChildID=${r.ChildID} ParentID=${r.ParentID}`);
        seen.add(k);
      }
    });

    test('bom_1083_10: deduped.length <= raw.length', () => {
      ok(tree1083_10.deduped.length <= rawBom1083_10.length,
        `deduped=${tree1083_10.deduped.length} raw=${rawBom1083_10.length}`);
    });

    test('bom_1083_10: assemblyIds are IDs that appear as ParentID', () => {
      const parentIds = new Set(tree1083_10.deduped.map(r => r.ParentID));
      for (const id of tree1083_10.assemblyIds) {
        ok(parentIds.has(id), `ID ${id} in assemblyIds but never a ParentID`);
      }
    });

    test('bom_1083_10: childrenMap covers every row', () => {
      let total = 0;
      for (const children of Object.values(tree1083_10.childrenMap)) total += children.length;
      eq(total, tree1083_10.deduped.length, 'childrenMap total rows !== deduped length');
    });

    test('bom_1083_10: topParentIds do not appear as children', () => {
      const childIds = new Set(tree1083_10.deduped.map(r => r.ChildID));
      for (const p of tree1083_10.topParentIds) {
        notOk(childIds.has(p), `topParentId ${p} appears as a ChildID`);
      }
    });

    test('bom_1083_10: exactly one top parent (single-root BOM)', () => {
      eq(tree1083_10.topParentIds.length, 1, 'Expected exactly 1 top parent for spec 10');
    });

    test('bom_1083_30: deduped has no duplicate (ChildID, ParentID) pairs', () => {
      const seen = new Set();
      for (const r of tree1083_30.deduped) {
        const k = `${r.ChildID}-${r.ParentID}`;
        ok(!seen.has(k), `Duplicate pair: ${k}`);
        seen.add(k);
      }
    });

    test('bom_1129_10: deduped has no duplicate (ChildID, ParentID) pairs', () => {
      const seen = new Set();
      for (const r of tree1129_10.deduped) {
        const k = `${r.ChildID}-${r.ParentID}`;
        ok(!seen.has(k), `Duplicate pair: ${k}`);
        seen.add(k);
      }
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  SECTION 2 — getAssemblyStats()
    // ═══════════════════════════════════════════════════════════════════════
    section('2 · getAssemblyStats() — readiness percentages');

    test('stats: total = received + noPO + ordered', () => {
      const stats = getAssemblyStats(topNode1083_10.TopItemID, tree1083_10.childrenMap, tree1083_10.assemblyIds);
      eq(stats.total, stats.received + stats.noPO + stats.ordered,
        `total(${stats.total}) != received(${stats.received}) + noPO(${stats.noPO}) + ordered(${stats.ordered})`);
    });

    test('stats: pct = round(received/total * 100)', () => {
      const stats = getAssemblyStats(topNode1083_10.TopItemID, tree1083_10.childrenMap, tree1083_10.assemblyIds);
      const expected = stats.total ? Math.round(stats.received / stats.total * 100) : 0;
      eq(stats.pct, expected, `pct mismatch: ${stats.pct} vs ${expected}`);
    });

    test('stats: pct is between 0 and 100 (all loaded BOMs)', () => {
      for (const [proj, specId, bomRows] of [
        [1083, 10, rawBom1083_10],
        [1083, 30, rawBom1083_30],
        [1129, 10, rawBom1129_10],
      ]) {
        const tn = proj === 1083 && specId === 10 ? topNode1083_10
                 : proj === 1083 && specId === 30 ? topNode1083_30
                 : topNode1129_10;
        const { assemblyIds, childrenMap } = buildTree(bomRows);
        const stats = getAssemblyStats(tn.TopItemID, childrenMap, assemblyIds);
        ok(stats.pct >= 0 && stats.pct <= 100, `pct out of range for ${proj}/${specId}: ${stats.pct}`);
      }
    });

    test('stats: received count matches leaves with ReceivedQty >= ItemQty', () => {
      const leaves = getLeafParts(topNode1083_10.TopItemID, tree1083_10.childrenMap, tree1083_10.assemblyIds);
      const unique  = Object.values(leaves.reduce((acc, p) => { acc[p.ChildID] = acc[p.ChildID] || p; return acc; }, {}));
      const received = unique.filter(p => p.ReceivedQty >= p.ItemQty);
      const stats = getAssemblyStats(topNode1083_10.TopItemID, tree1083_10.childrenMap, tree1083_10.assemblyIds);
      eq(stats.received, received.length, 'received count mismatch');
    });

    test('stats: noPO parts have POQty=0 and ReceivedQty < ItemQty', () => {
      const leaves = getLeafParts(topNode1083_10.TopItemID, tree1083_10.childrenMap, tree1083_10.assemblyIds);
      const unique  = Object.values(leaves.reduce((acc, p) => { acc[p.ChildID] = acc[p.ChildID] || p; return acc; }, {}));
      const noPO    = unique.filter(p => p.POQty === 0 && p.ReceivedQty < p.ItemQty);
      const stats   = getAssemblyStats(topNode1083_10.TopItemID, tree1083_10.childrenMap, tree1083_10.assemblyIds);
      eq(stats.noPO, noPO.length, 'noPO count mismatch');
    });

    test('stats: ordered parts have POQty>0 and ReceivedQty < ItemQty', () => {
      const leaves  = getLeafParts(topNode1083_10.TopItemID, tree1083_10.childrenMap, tree1083_10.assemblyIds);
      const unique  = Object.values(leaves.reduce((acc, p) => { acc[p.ChildID] = acc[p.ChildID] || p; return acc; }, {}));
      const ordered = unique.filter(p => p.POQty > 0 && p.ReceivedQty < p.ItemQty);
      const stats   = getAssemblyStats(topNode1083_10.TopItemID, tree1083_10.childrenMap, tree1083_10.assemblyIds);
      eq(stats.ordered, ordered.length, 'ordered count mismatch');
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  SECTION 3 — buildNestedTree()
    // ═══════════════════════════════════════════════════════════════════════
    section('3 · buildNestedTree() — part status and structure');

    const nestedTree1083_10 = buildNestedTree(
      topNode1083_10.TopItemID, topNode1083_10.TopPN, topNode1083_10.TopDesc,
      tree1083_10.childrenMap, tree1083_10.assemblyIds, poIndex1083
    );

    test('nestedTree: root id matches TopItemID', () => {
      eq(nestedTree1083_10.id, topNode1083_10.TopItemID, 'Root id mismatch');
    });

    test('nestedTree: root is an assembly', () => {
      ok(nestedTree1083_10.isAssembly, 'Root node should be an assembly');
    });

    test('nestedTree: root has stats', () => {
      ok(nestedTree1083_10.stats, 'Root node should have stats');
      ok(typeof nestedTree1083_10.stats.pct === 'number', 'stats.pct should be a number');
    });

    test('nestedTree: part status "received" iff receivedQty >= qty', () => {
      function collectParts(node) {
        return [...(node.parts || []), ...(node.children || []).flatMap(collectParts)];
      }
      for (const p of collectParts(nestedTree1083_10)) {
        if (p.status === 'received') {
          ok(p.receivedQty >= p.qty, `Part ${p.pn} marked received but receivedQty(${p.receivedQty}) < qty(${p.qty})`);
        }
        if (p.status === 'ordered') {
          ok(p.poQty > 0, `Part ${p.pn} marked ordered but poQty=${p.poQty}`);
          ok(p.receivedQty < p.qty, `Part ${p.pn} marked ordered but already received`);
        }
        if (p.status === 'noPO') {
          eq(p.poQty, 0, `Part ${p.pn} marked noPO but poQty=${p.poQty}`);
        }
      }
    });

    test('nestedTree: PO index lines attached correctly (ItemID match)', () => {
      function collectParts(node) {
        return [...(node.parts || []), ...(node.children || []).flatMap(collectParts)];
      }
      for (const p of collectParts(nestedTree1083_10)) {
        for (const _line of (p.pos || [])) {
          ok(poIndex1083[p.id], `Part id ${p.id} has PO lines but no entry in poIndex`);
        }
      }
    });

    test('nestedTree: assembly children have stats', () => {
      function walk(node) {
        if (node.isAssembly) {
          ok(node.stats, `Assembly ${node.pn} (id=${node.id}) missing stats`);
        }
        for (const child of (node.children || [])) walk(child);
      }
      walk(nestedTree1083_10);
    });

    test('nestedTree: every isAssembly node is in assemblyIds', () => {
      function walk(node) {
        if (node.isAssembly) {
          ok(tree1083_10.assemblyIds.has(node.id), `Node ${node.id} isAssembly=true but not in assemblyIds`);
        }
        for (const child of (node.children || [])) walk(child);
      }
      walk(nestedTree1083_10);
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  SECTION 4 — buildPoActionList()
    // ═══════════════════════════════════════════════════════════════════════
    section('4 · buildPoActionList() — PO categorization');

    test('poActions: all four category arrays exist', () => {
      ok(Array.isArray(poActions1083.critical),  'critical missing');
      ok(Array.isArray(poActions1083.warning),   'warning missing');
      ok(Array.isArray(poActions1083.onTrack),   'onTrack missing');
      ok(Array.isArray(poActions1083.delivered), 'delivered missing');
    });

    test('poActions: no PO appears in multiple categories', () => {
      const seen = new Map();
      for (const [cat, arr] of [
        ['critical', poActions1083.critical], ['warning', poActions1083.warning],
        ['onTrack', poActions1083.onTrack],   ['delivered', poActions1083.delivered],
      ]) {
        for (const e of arr) {
          ok(!seen.has(e.po.poId), `PO ${e.po.poId} in both ${seen.get(e.po.poId)} and ${cat}`);
          seen.set(e.po.poId, cat);
        }
      }
    });

    test('poActions: delivered entries have all parts received', () => {
      for (const e of poActions1083.delivered) {
        const allRcvd = e.po.parts.every(p => p.received >= p.qty);
        ok(allRcvd, `PO ${e.po.poId} in delivered but not all parts received`);
      }
    });

    test('poActions: critical entries have at least one overdue active part', () => {
      for (const e of poActions1083.critical) {
        const activeParts = e.po.parts.filter(p => p.received < p.qty);
        ok(activeParts.length > 0, `PO ${e.po.poId} is critical but no active parts`);
        ok(e.worstDays < 0, `PO ${e.po.poId} is critical but worstDays=${e.worstDays} >= 0`);
      }
    });

    test('poActions: warning entries have worstDays in [0, 14]', () => {
      for (const e of poActions1083.warning) {
        ok(e.worstDays >= 0 && e.worstDays <= 14,
          `PO ${e.po.poId} in warning but worstDays=${e.worstDays}`);
      }
    });

    test('poActions: onTrack entries have worstDays > 14', () => {
      for (const e of poActions1083.onTrack) {
        ok(e.worstDays > 14, `PO ${e.po.poId} in onTrack but worstDays=${e.worstDays}`);
      }
    });

    test('poActions: critical sorted ascending by worstDays', () => {
      const days = poActions1083.critical.map(e => e.worstDays);
      for (let i = 1; i < days.length; i++) {
        ok(days[i] >= days[i-1], `critical out of order at index ${i}: ${days[i-1]} > ${days[i]}`);
      }
    });

    test('poActions: warning sorted ascending by worstDays', () => {
      const days = poActions1083.warning.map(e => e.worstDays);
      for (let i = 1; i < days.length; i++) {
        ok(days[i] >= days[i-1], `warning out of order at index ${i}: ${days[i-1]} > ${days[i]}`);
      }
    });

    test('poActions: total PO count matches unique PO IDs (1083)', () => {
      const uniquePOs = new Set(poRows1083.map(r => r.PurchaseOrderID));
      const total = poActions1083.critical.length + poActions1083.warning.length +
                    poActions1083.onTrack.length  + poActions1083.delivered.length;
      eq(total, uniquePOs.size, `action list total(${total}) != unique PO count(${uniquePOs.size})`);
    });

    test('poActions: total PO count matches unique PO IDs (1129)', () => {
      const uniquePOs = new Set(poRows1129.map(r => r.PurchaseOrderID));
      const total = poActions1129.critical.length + poActions1129.warning.length +
                    poActions1129.onTrack.length  + poActions1129.delivered.length;
      eq(total, uniquePOs.size, `action list total(${total}) != unique PO count(${uniquePOs.size})`);
    });

    test('poActions: each entry has supplier and po.parts', () => {
      const all = [...poActions1083.critical, ...poActions1083.warning,
                   ...poActions1083.onTrack,  ...poActions1083.delivered];
      for (const e of all) {
        ok('supplier' in e, `Entry PO ${e.po?.poId} missing supplier`);
        ok(Array.isArray(e.po?.parts), `po.parts is not an array for PO ${e.po?.poId}`);
        ok(e.po.parts.length > 0, `PO ${e.po.poId} has no parts`);
      }
    });

    test('poActions: remaining = qty - received for each part', () => {
      const all = [...poActions1083.critical, ...poActions1083.warning,
                   ...poActions1083.onTrack,  ...poActions1083.delivered];
      for (const e of all) {
        for (const p of e.po.parts) {
          eq(p.remaining, p.qty - p.received,
            `Part ${p.partNumber} remaining(${p.remaining}) != qty(${p.qty}) - received(${p.received})`);
        }
      }
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  SECTION 5 — buildPoIndex()
    // ═══════════════════════════════════════════════════════════════════════
    section('5 · buildPoIndex() — ItemID lookup map');

    test('poIndex: every ItemID in raw PO rows appears in index', () => {
      const itemIds = new Set(poRows1083.map(r => r.ItemID));
      for (const id of itemIds) {
        ok(poIndex1083[id], `ItemID ${id} missing from poIndex`);
        ok(poIndex1083[id].length > 0, `ItemID ${id} has empty array in poIndex`);
      }
    });

    test('poIndex: no extra ItemIDs not in raw data', () => {
      const itemIds = new Set(poRows1083.map(r => r.ItemID));
      for (const id of Object.keys(poIndex1083)) {
        ok(itemIds.has(Number(id)), `poIndex has ItemID ${id} not in raw PO rows`);
      }
    });

    test('poIndex: each line has required fields', () => {
      for (const lines of Object.values(poIndex1083)) {
        for (const line of lines) {
          ok('poId'     in line, `poIndex line missing poId`);
          ok('qty'      in line, `poIndex line missing qty`);
          ok('received' in line, `poIndex line missing received`);
          ok('supplier' in line, `poIndex line missing supplier`);
        }
      }
    });

    test('poIndex: received values match raw PO rows', () => {
      for (const row of poRows1083) {
        const lines = poIndex1083[row.ItemID] || [];
        const match = lines.find(l => l.poId === row.PurchaseOrderID);
        ok(match, `No index line for ItemID=${row.ItemID} poId=${row.PurchaseOrderID}`);
        eq(match.received, row.ReceivedQty,
          `received mismatch for ItemID=${row.ItemID}: index=${match.received} raw=${row.ReceivedQty}`);
      }
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  SECTION 6 — findNoPoParts()
    // ═══════════════════════════════════════════════════════════════════════
    section('6 · findNoPoParts() — parts without purchase orders');

    const noPo1083_10 = findNoPoParts(rawBom1083_10, tree1083_10.assemblyIds);

    test('noPoParts: no assemblies in result', () => {
      for (const p of noPo1083_10) {
        notOk(tree1083_10.assemblyIds.has(p.id),
          `Part ${p.pn} (id=${p.id}) is in assemblyIds but returned by findNoPoParts`);
      }
    });

    test('noPoParts: all results have POQty=0 and ReceivedQty < ItemQty', () => {
      const bomById = Object.fromEntries(rawBom1083_10.map(r => [r.ChildID, r]));
      for (const p of noPo1083_10) {
        const raw = bomById[p.id];
        ok(raw, `No BOM row for noPO part id=${p.id}`);
        eq(raw.POQty, 0, `Part ${p.pn} has POQty=${raw.POQty}, should be 0`);
        ok(raw.ReceivedQty < raw.ItemQty,
          `Part ${p.pn} is already received (${raw.ReceivedQty}/${raw.ItemQty}) but in noPO list`);
      }
    });

    test('noPoParts: no duplicate ChildIDs', () => {
      const seen = new Set();
      for (const p of noPo1083_10) {
        notOk(seen.has(p.id), `Duplicate ChildID ${p.id} (${p.pn}) in noPoParts`);
        seen.add(p.id);
      }
    });

    test('noPoParts: count matches manual filter on deduped rows', () => {
      const { assemblyIds, deduped } = tree1083_10;
      const seen = new Set();
      let expected = 0;
      for (const r of deduped) {
        if (assemblyIds.has(r.ChildID)) continue;
        if (r.POQty !== 0 || r.ReceivedQty >= r.ItemQty) continue;
        if (seen.has(r.ChildID)) continue;
        seen.add(r.ChildID);
        expected++;
      }
      eq(noPo1083_10.length, expected, `noPoParts count ${noPo1083_10.length} != manual ${expected}`);
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  SECTION 7 — buildReadinessSummary()
    // ═══════════════════════════════════════════════════════════════════════
    section('7 · buildReadinessSummary() — machine and sub-assembly grouping');

    const summary1083_10 = buildReadinessSummary(
      topNode1083_10.TopItemID, topNode1083_10.TopPN, topNode1083_10.TopDesc,
      tree1083_10.childrenMap, tree1083_10.assemblyIds, poIndex1083
    );

    test('summary: machines array is non-empty', () => {
      ok(summary1083_10.machines.length > 0, 'No machines returned');
    });

    test('summary: every machine has id, pn, desc, stats, subAssemblies, parts', () => {
      for (const m of summary1083_10.machines) {
        if (m.id === 'loose-parts') continue;
        ok(m.id,    `Machine missing id`);
        ok(m.pn,    `Machine ${m.id} missing pn`);
        ok(m.stats, `Machine ${m.id} missing stats`);
        ok(m.subAssemblies, `Machine ${m.id} missing subAssemblies`);
        ok(Array.isArray(m.parts), `Machine ${m.id} parts is not array`);
      }
    });

    test('summary: sub-assembly ready group has pct=100', () => {
      for (const m of summary1083_10.machines) {
        for (const sub of (m.subAssemblies?.ready || [])) {
          eq(sub.stats.pct, 100, `${sub.pn} in ready group but pct=${sub.stats.pct}`);
        }
      }
    });

    test('summary: sub-assembly close group has 60 <= pct < 100', () => {
      for (const m of summary1083_10.machines) {
        for (const sub of (m.subAssemblies?.close || [])) {
          ok(sub.stats.pct >= 60 && sub.stats.pct < 100,
            `${sub.pn} in close group but pct=${sub.stats.pct}`);
        }
      }
    });

    test('summary: sub-assembly blocked group has pct < 60', () => {
      for (const m of summary1083_10.machines) {
        for (const sub of (m.subAssemblies?.blocked || [])) {
          ok(sub.stats.pct < 60, `${sub.pn} in blocked group but pct=${sub.stats.pct}`);
        }
      }
    });

    test('summary: close list sorted descending by pct', () => {
      for (const m of summary1083_10.machines) {
        const pcts = (m.subAssemblies?.close || []).map(s => s.stats.pct);
        for (let i = 1; i < pcts.length; i++) {
          ok(pcts[i] <= pcts[i-1], `close sub-assemblies out of order: ${pcts[i-1]} then ${pcts[i]}`);
        }
      }
    });

    test('summary: tree root matches TopItemID', () => {
      eq(summary1083_10.tree.id, topNode1083_10.TopItemID, 'summary.tree.id mismatch');
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  SECTION 8 — Full pipeline
    // ═══════════════════════════════════════════════════════════════════════
    section('8 · Full pipeline — project 1083');

    const pipeline1083 = await runPipeline(1083, allBomData, allPoRows);
    const pipeline1129 = await runPipeline(1129, allBomData, allPoRows);

    test('pipeline 1083: project name is SDC Show Room', () => {
      eq(pipeline1083.project.ProjectName, 'SDC Show Room', 'Project name mismatch');
    });

    test('pipeline 1083: returns 2 specs', () => {
      eq(pipeline1083.specs.length, 2, `Expected 2 specs, got ${pipeline1083.specs.length}`);
    });

    test('pipeline 1083: spec IDs are 10 and 30', () => {
      const ids = pipeline1083.specs.map(s => s.specId).sort((a, b) => a - b);
      eq(ids[0], 10, 'First spec ID should be 10');
      eq(ids[1], 30, 'Second spec ID should be 30');
    });

    test('pipeline 1083: spec names match demo definition', () => {
      const byId = Object.fromEntries(pipeline1083.specs.map(s => [s.specId, s]));
      eq(byId[10].specName, 'Mechanical Design and Build', 'Spec 10 name mismatch');
      eq(byId[30].specName, 'Controls Design', 'Spec 30 name mismatch');
    });

    test('pipeline 1083: totalParts > 0 for each spec', () => {
      for (const s of pipeline1083.specs) {
        ok(s.totalParts > 0, `Spec ${s.specId} has 0 totalParts`);
      }
    });

    test('pipeline 1083: machines array non-empty for each spec', () => {
      for (const s of pipeline1083.specs) {
        ok(s.machines.length > 0, `Spec ${s.specId} has no machines`);
      }
    });

    test('pipeline 1083: poActions total = unique PO count', () => {
      const pa = pipeline1083.poActions;
      const uniquePOs = new Set(poRows1083.map(r => r.PurchaseOrderID));
      const total = pa.critical.length + pa.warning.length + pa.onTrack.length + pa.delivered.length;
      eq(total, uniquePOs.size, `PO total mismatch: ${total} vs ${uniquePOs.size}`);
    });

    test('pipeline 1083: tree.stats matches getAssemblyStats for top node', () => {
      const spec10 = pipeline1083.specs.find(s => s.specId === 10);
      const { assemblyIds, childrenMap } = buildTree(rawBom1083_10);
      const expectedStats = getAssemblyStats(topNode1083_10.TopItemID, childrenMap, assemblyIds);
      eq(spec10.tree.stats.pct,      expectedStats.pct,      'tree.stats.pct mismatch');
      eq(spec10.tree.stats.total,    expectedStats.total,    'tree.stats.total mismatch');
      eq(spec10.tree.stats.received, expectedStats.received, 'tree.stats.received mismatch');
    });

    test('pipeline 1129: project name is Molex Duplex', () => {
      eq(pipeline1129.project.ProjectName, 'Molex Duplex', 'Project name mismatch');
    });

    test('pipeline 1129: returns 2 specs', () => {
      eq(pipeline1129.specs.length, 2, `Expected 2 specs, got ${pipeline1129.specs.length}`);
    });

    test('pipeline 1129: no duplicate POs across categories', () => {
      const seen = new Map();
      const pa = pipeline1129.poActions;
      for (const [cat, arr] of [['critical', pa.critical], ['warning', pa.warning], ['onTrack', pa.onTrack], ['delivered', pa.delivered]]) {
        for (const e of arr) {
          ok(!seen.has(e.po.poId), `PO ${e.po.poId} in ${seen.get(e.po.poId)} and ${cat}`);
          seen.set(e.po.poId, cat);
        }
      }
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  SECTION 9 — Frontend mapping
    // ═══════════════════════════════════════════════════════════════════════
    section('9 · Frontend mapping — app.jsx data transformation');

    const fe1083 = frontendMap(pipeline1083);
    const fe1129 = frontendMap(pipeline1129);

    test('fe: job.id matches project.ProjectID', () => {
      eq(fe1083.job.id, pipeline1083.project.ProjectID, 'job.id mismatch');
    });

    test('fe: job.name matches project.ProjectName', () => {
      eq(fe1083.job.name, pipeline1083.project.ProjectName, 'job.name mismatch');
    });

    test('fe: readiness spec count matches backend', () => {
      eq(fe1083.readiness.length, pipeline1083.specs.length, 'spec count mismatch');
    });

    test('fe: readiness assembly count matches backend machine count per spec', () => {
      for (let i = 0; i < pipeline1083.specs.length; i++) {
        const backendCount  = pipeline1083.specs[i].machines.length;
        const frontendCount = fe1083.readiness[i].assemblies.length;
        eq(frontendCount, backendCount,
          `Spec ${pipeline1083.specs[i].specId}: machine count ${frontendCount} != ${backendCount}`);
      }
    });

    test('fe: assembly pct = backend machine.stats.pct', () => {
      for (let si = 0; si < pipeline1083.specs.length; si++) {
        const beMachines = pipeline1083.specs[si].machines;
        const feMachines = fe1083.readiness[si].assemblies;
        for (let mi = 0; mi < beMachines.length; mi++) {
          const expected = beMachines[mi].stats?.pct || 0;
          eq(feMachines[mi].pct, expected,
            `Spec ${pipeline1083.specs[si].specId} machine[${mi}].pct: ${feMachines[mi].pct} != ${expected}`);
        }
      }
    });

    test('fe: assembly status thresholds (pct>=85→ready, >=60→close, else blocked)', () => {
      for (const spec of fe1083.readiness) {
        for (const a of spec.assemblies) {
          if (a.pct >= 85)        eq(a.status, 'ready',   `${a.pn}: pct=${a.pct} should be ready`);
          else if (a.pct >= 60)   eq(a.status, 'close',   `${a.pn}: pct=${a.pct} should be close`);
          else                    eq(a.status, 'blocked',  `${a.pn}: pct=${a.pct} should be blocked`);
        }
      }
    });

    test('fe: KPI.assemblies = total machine count across all specs', () => {
      const expected = fe1083.readiness.reduce((s, spec) => s + spec.assemblies.length, 0);
      eq(fe1083.job.kpis.assemblies, expected, `kpis.assemblies ${fe1083.job.kpis.assemblies} != ${expected}`);
    });

    test('fe: KPI.ready + close + blocked = KPI.assemblies', () => {
      const { ready, close, blocked, assemblies } = fe1083.job.kpis;
      eq(ready + close + blocked, assemblies,
        `ready(${ready}) + close(${close}) + blocked(${blocked}) != assemblies(${assemblies})`);
    });

    test('fe: KPI.noPO = length of deduplicated nopo array', () => {
      eq(fe1083.job.kpis.noPO, fe1083.nopo.length,
        `kpis.noPO(${fe1083.job.kpis.noPO}) != nopo.length(${fe1083.nopo.length})`);
    });

    test('fe: nopo list matches flat noPoParts from all backend specs', () => {
      const backendTotal = pipeline1083.specs.reduce((s, spec) => s + (spec.noPoParts?.length || 0), 0);
      eq(fe1083.nopo.length, backendTotal,
        `frontend nopo(${fe1083.nopo.length}) != backend total(${backendTotal})`);
    });

    test('fe: poActions passed through unchanged', () => {
      eq(
        JSON.stringify(fe1083.poActions),
        JSON.stringify(pipeline1083.poActions),
        'poActions was mutated during frontend mapping'
      );
    });

    test('fe: actMat = projectCosting.ActMaterials', () => {
      const expected = pipeline1083.projectCosting?.ActMaterials || 0;
      eq(fe1083.job.actMat, expected, `actMat mismatch: ${fe1083.job.actMat} vs ${expected}`);
    });

    test('fe: estMat is null when EstMaterials <= 1000, non-null otherwise', () => {
      const est = pipeline1083.projectCosting?.EstMaterials;
      if (est > 1000) {
        ok(fe1083.job.estMat !== null, `estMat should not be null when EstMaterials=${est}`);
      } else {
        eq(fe1083.job.estMat, null, `estMat should be null when EstMaterials=${est}`);
      }
    });

    test('fe: marginActual = ActualMargin / 100', () => {
      const raw = pipeline1083.projectCosting?.ActualMargin;
      const expected = raw != null ? raw / 100 : null;
      eq(fe1083.job.marginActual, expected, `marginActual: ${fe1083.job.marginActual} != ${expected}`);
    });

    test('fe: marginTarget = BudgetMargin / 100 when > 0', () => {
      const raw = pipeline1083.projectCosting?.BudgetMargin;
      const expected = raw > 0 ? raw / 100 : null;
      eq(fe1083.job.marginTarget, expected, `marginTarget: ${fe1083.job.marginTarget} != ${expected}`);
    });

    test('fe: costing laborHrs = EngHours + MfgHours', () => {
      for (let i = 0; i < fe1083.costing.length; i++) {
        const raw      = pipeline1083.specCosting[i];
        const expected = (raw.EngHours || 0) + (raw.MfgHours || 0);
        eq(fe1083.costing[i].laborHrs, expected, `costing[${i}].laborHrs: ${fe1083.costing[i].laborHrs} != ${expected}`);
      }
    });

    test('fe: costing labor = EngLabor + MfgLabor', () => {
      for (let i = 0; i < fe1083.costing.length; i++) {
        const raw      = pipeline1083.specCosting[i];
        const expected = (raw.EngLabor || 0) + (raw.MfgLabor || 0);
        eq(fe1083.costing[i].labor, expected, `costing[${i}].labor: ${fe1083.costing[i].labor} != ${expected}`);
      }
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  SECTION 10 — Cross-project invariants
    // ═══════════════════════════════════════════════════════════════════════
    section('10 · Cross-project invariants');

    test('both projects: no dramatically over-received part (ReceivedQty > POQty*3)', () => {
      for (const [proj, specId, rows] of [
        [1083, 10, rawBom1083_10], [1083, 30, rawBom1083_30],
        [1129, 10, rawBom1129_10], [1129, 30, rawBom1129_30],
      ]) {
        for (const r of rows) {
          if (r.ReceivedQty > r.POQty * 3 && r.POQty > 0) {
            ok(false, `Suspicious: ${proj}/${specId} ChildPN=${r.ChildPN} Rcvd=${r.ReceivedQty} POQty=${r.POQty}`);
          }
        }
      }
    });

    test('both projects: every PO row has a PurchaseOrderID', () => {
      for (const [proj, rows] of [[1083, poRows1083], [1129, poRows1129]]) {
        for (const r of rows) {
          ok(r.PurchaseOrderID, `Project ${proj}: row with ItemID=${r.ItemID} has no PurchaseOrderID`);
        }
      }
    });

    test('both projects: machine pct values are integers (no float drift)', () => {
      for (const [proj, pipeline] of [[1083, pipeline1083], [1129, pipeline1129]]) {
        for (const spec of pipeline.specs) {
          for (const m of spec.machines) {
            if (!m.stats) continue;
            eq(m.stats.pct, Math.round(m.stats.pct),
              `Project ${proj} machine ${m.pn} pct=${m.stats.pct} is not integer`);
          }
        }
      }
    });

    test('both projects: noPoParts ids unique across specs (global dedup enforced)', () => {
      for (const [proj, pipeline] of [[1083, pipeline1083], [1129, pipeline1129]]) {
        const seen = new Set();
        for (const spec of pipeline.specs) {
          for (const p of (spec.noPoParts || [])) {
            notOk(seen.has(p.id), `Project ${proj}: noPO part ${p.pn} (id=${p.id}) duplicated across specs`);
            seen.add(p.id);
          }
        }
      }
    });

    test('fe 1129: KPI ready + close + blocked = total assemblies', () => {
      const { ready, close, blocked, assemblies } = fe1129.job.kpis;
      eq(ready + close + blocked, assemblies,
        `1129 KPI: ${ready}+${close}+${blocked} != ${assemblies}`);
    });

    test('timeline tooltip: grpRcvd <= grpQty for every PO group', () => {
      const all = [...poActions1083.critical, ...poActions1083.warning,
                   ...poActions1083.onTrack,  ...poActions1083.delivered];
      for (const e of all) {
        const grpQty  = e.po.parts.reduce((s, p) => s + p.qty, 0);
        const grpRcvd = e.po.parts.reduce((s, p) => s + p.received, 0);
        ok(grpQty  >= grpRcvd, `PO ${e.po.poId}: grpQty(${grpQty}) < grpRcvd(${grpRcvd})`);
        ok(grpQty  > 0, `PO ${e.po.poId}: grpQty is 0`);
      }
    });

    // ═══════════════════════════════════════════════════════════════════════
    //  SECTIONS 11 & 12 — Smartsheet + Gantt (pure-logic, no async needed)
    // ═══════════════════════════════════════════════════════════════════════
    runSmartsheetUnitTests();
    runGanttMappingTests(poRows1083, poActions1083);

  } catch (err) {
    process.stdout.write(`\n\x1b[31mFATAL ERROR (suite setup):\x1b[0m ${err.message}\n${err.stack}\n`);
    process.exit(2);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const total = passed + failed;
  process.stdout.write(`\n${'─'.repeat(60)}\n`);
  process.stdout.write(`Tests: ${total}  `);
  process.stdout.write(`\x1b[32mPassed: ${passed}\x1b[0m  `);
  if (failed > 0) {
    process.stdout.write(`\x1b[31mFailed: ${failed}\x1b[0m\n`);
    process.stdout.write(`\nFailing tests:\n`);
    failures.forEach(f => process.stdout.write(`  • ${f.name}\n    ${f.message}\n`));
    process.exit(1);
  } else {
    process.stdout.write(`\x1b[32mAll tests passed ✓\x1b[0m\n`);
  }
})();
