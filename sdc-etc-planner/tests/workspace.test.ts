import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_WORKSPACE,
  MAX_TABS,
  openTab,
  activateTab,
  setTabParams,
  closeTab,
  moveTab,
  enterSplit,
  exitSplit,
  setSplitRatio,
  sidebarTarget,
  encodeWorkspace,
  decodeWorkspace,
  workspaceHref,
  tabHref,
  tabLabel,
  type Workspace,
} from "../src/lib/workspace";

const ws = (paths: string[], over: Partial<Workspace> = {}): Workspace => ({
  tabs: paths.map((p) => ({ path: p, params: {} })),
  active: 0,
  split: null,
  ...over,
});

// ── Opening ─────────────────────────────────────────────────────────────────

test("the requested workflow, start to finish", () => {
  // 1. Viewing Monthly ETC. 2-3. Sidebar click opens Job Hour Details as another tab.
  let w = openTab(EMPTY_WORKSPACE, "/etc", { month: "2026-08" });
  w = openTab(w, "/job-hours", { jobs: "1131" });
  assert.deepEqual(w.tabs.map((t) => t.path), ["/etc", "/job-hours"]);
  assert.equal(w.active, 1, "a newly opened tab becomes active");

  // 4. Switch back without losing the other tab's state.
  w = activateTab(w, 0);
  assert.equal(w.active, 0);
  assert.deepEqual(w.tabs[1].params, { jobs: "1131" }, "the other tab kept its job");
  assert.deepEqual(w.tabs[0].params, { month: "2026-08" }, "and this one kept its month");

  // 5-8. Split View, choosing the other open tab.
  w = enterSplit(w, 1);
  assert.deepEqual(w.split, { left: 0, right: 1, ratio: 50 });

  // 9. Exit, back to the standard tabbed layout.
  w = exitSplit(w);
  assert.equal(w.split, null);
  assert.equal(w.active, 0);
  assert.equal(w.tabs.length, 2, "exiting the split closes no tabs");
});

test("opening a page that is already open activates it instead of duplicating", () => {
  let w = openTab(openTab(EMPTY_WORKSPACE, "/etc"), "/job-hours");
  w = openTab(w, "/etc");
  assert.equal(w.tabs.length, 2, "no duplicate tab");
  assert.equal(w.active, 0, "the existing tab is activated");
});

test("matching is on path alone, so a different month does not open a second tab", () => {
  // Deliberate: clicking Monthly ETC in the sidebar while an ETC tab is open on
  // another month should take you there. Two months side by side is what Split View
  // is for.
  let w = openTab(EMPTY_WORKSPACE, "/etc", { month: "2026-08" });
  w = openTab(w, "/etc", { month: "2026-07" });
  assert.equal(w.tabs.length, 1);
  assert.deepEqual(w.tabs[0].params, { month: "2026-08" }, "the open tab's own month is not overwritten");
});

test("a route that cannot be hosted is refused rather than half-opened", () => {
  const w = openTab(EMPTY_WORKSPACE, "/admin/users");
  assert.deepEqual(w, EMPTY_WORKSPACE);
});

test("params are filtered to what the route actually reads", () => {
  const w = openTab(EMPTY_WORKSPACE, "/jobs", { q: "1131", month: "2026-08" });
  assert.deepEqual(w.tabs[0].params, { q: "1131" }, "/jobs has no month param");
});

test("at the cap, the oldest tab NOT in use is replaced", () => {
  let w = EMPTY_WORKSPACE;
  const paths = ["/etc", "/job-hours", "/quoted", "/hours", "/tm", "/build-readiness", "/jobs", "/employees"];
  for (const p of paths) w = openTab(w, p);
  assert.equal(w.tabs.length, MAX_TABS);

  // Split two of them, and sit on a third, so three are protected.
  w = activateTab(w, 3);
  w = enterSplit(w, 5);
  const before = w.tabs.length;
  w = openTab(w, "/audit-log");
  assert.equal(w.tabs.length, before, "still at the cap, not over it");
  assert.equal(w.tabs[w.active].path, "/audit-log");
  // Nothing that was in use got dropped.
  assert.ok(w.tabs.some((t) => t.path === "/hours"), "the tab that was active survived");
  assert.ok(w.tabs.some((t) => t.path === "/build-readiness"), "a split tab survived");
});

// ── Closing: the operation most likely to corrupt the workspace ────────────

test("closing a tab shifts every index that pointed past it", () => {
  // `active` and both split references are indices into the array being spliced.
  let w = ws(["/etc", "/job-hours", "/quoted", "/hours"], { active: 3 });
  w = closeTab(w, 1);
  assert.deepEqual(w.tabs.map((t) => t.path), ["/etc", "/quoted", "/hours"]);
  assert.equal(w.active, 2, "the active tab moved down with the splice, not to a different page");
});

test("closing the active tab falls to its neighbour", () => {
  let w = ws(["/etc", "/job-hours", "/quoted"], { active: 1 });
  w = closeTab(w, 1);
  assert.deepEqual(w.tabs.map((t) => t.path), ["/etc", "/quoted"]);
  assert.equal(w.active, 1, "the tab that slid into place");
});

test("closing the last tab leaves an empty workspace, not a dangling index", () => {
  assert.deepEqual(closeTab(ws(["/etc"]), 0), EMPTY_WORKSPACE);
});

test("closing a tab that is IN the split ends the split, keeping the survivor", () => {
  let w = ws(["/etc", "/job-hours", "/quoted"], { active: 0, split: { left: 0, right: 2, ratio: 50 } });
  w = closeTab(w, 2);
  assert.equal(w.split, null, "a pane pointing at nothing is not a state to allow");
  assert.equal(w.tabs[w.active].path, "/etc", "the survivor became the active tab");
});

test("closing a tab OUTSIDE the split repoints the split, keeping it open", () => {
  let w = ws(["/etc", "/job-hours", "/quoted"], { active: 1, split: { left: 1, right: 2, ratio: 60 } });
  w = closeTab(w, 0);
  assert.deepEqual(w.tabs.map((t) => t.path), ["/job-hours", "/quoted"]);
  assert.deepEqual(w.split, { left: 0, right: 1, ratio: 60 }, "both references shifted down");
});

test("closing out of range changes nothing", () => {
  const w = ws(["/etc"]);
  assert.deepEqual(closeTab(w, 5), w);
  assert.deepEqual(closeTab(w, -1), w);
});

// ── Reordering ─────────────────────────────────────────────────────────────

test("dragging a tab carries the active and split references with it", () => {
  let w = ws(["/etc", "/job-hours", "/quoted"], { active: 0 });
  w = moveTab(w, 0, 2);
  assert.deepEqual(w.tabs.map((t) => t.path), ["/job-hours", "/quoted", "/etc"]);
  assert.equal(w.active, 2, "still Monthly ETC, at its new position");
  assert.equal(w.tabs[w.active].path, "/etc");
});

test("a reorder never silently repoints the split at a different page", () => {
  let w = ws(["/etc", "/job-hours", "/quoted"], { active: 0, split: { left: 0, right: 1, ratio: 50 } });
  const before = [w.tabs[w.split!.left].path, w.tabs[w.split!.right].path];
  w = moveTab(w, 2, 0);
  const after = [w.tabs[w.split!.left].path, w.tabs[w.split!.right].path];
  assert.deepEqual(after, before, "the split still shows the same two PAGES");
});

test("moveTab clamps a target past the end, and a no-op is a no-op", () => {
  const w = ws(["/etc", "/job-hours"]);
  assert.deepEqual(moveTab(w, 0, 99).tabs.map((t) => t.path), ["/job-hours", "/etc"]);
  assert.deepEqual(moveTab(w, 1, 1), w);
});

// ── Split ──────────────────────────────────────────────────────────────────

test("a tab cannot be split against itself, or against one that does not exist", () => {
  const w = ws(["/etc", "/job-hours"], { active: 0 });
  assert.equal(enterSplit(w, 0).split, null, "same tab");
  assert.equal(enterSplit(w, 7).split, null, "out of range");
});

test("the ratio is clamped, so a pane can never become an unusable sliver", () => {
  const w = enterSplit(ws(["/etc", "/job-hours"], { active: 0 }), 1);
  assert.equal(setSplitRatio(w, 5).split!.ratio, 20);
  assert.equal(setSplitRatio(w, 95).split!.ratio, 80);
  assert.equal(setSplitRatio(w, 65).split!.ratio, 65);
});

test("exiting the split can keep either pane", () => {
  const w = ws(["/etc", "/job-hours"], { active: 0, split: { left: 0, right: 1, ratio: 50 } });
  assert.equal(exitSplit(w).active, 0, "the left pane by default");
  assert.equal(exitSplit(w, 1).active, 1);
});

test("the sidebar targets the tab the user was last in", () => {
  const w = ws(["/etc", "/job-hours"], { active: 1, split: { left: 1, right: 0, ratio: 50 } });
  assert.equal(sidebarTarget(w), 1);
});

// ── Params stay per tab ────────────────────────────────────────────────────

test("changing one tab's params leaves every other tab alone", () => {
  // The property that makes tabs independent, and the same one the split's `l.`/`r.`
  // prefixes gave: two tabs on the SAME route with different jobs.
  let w = openTab(openTab(EMPTY_WORKSPACE, "/job-hours", { jobs: "1131" }), "/jobs", { q: "x" });
  w = setTabParams(w, 0, { jobs: "1105" });
  assert.deepEqual(w.tabs[0].params, { jobs: "1105" });
  assert.deepEqual(w.tabs[1].params, { q: "x" });
});

// ── URL ────────────────────────────────────────────────────────────────────

test("a workspace round-trips through the URL unchanged", () => {
  const w: Workspace = {
    tabs: [
      { path: "/etc", params: { month: "2026-08", dept: "ENG" } },
      { path: "/job-hours", params: { jobs: "1131" } },
      { path: "/build-readiness", params: {} },
    ],
    active: 2,
    split: { left: 0, right: 1, ratio: 65 },
  };
  assert.deepEqual(decodeWorkspace(Object.fromEntries(new URLSearchParams(encodeWorkspace(w)))), w);
});

test("two tabs on the same route keep separate params in one URL", () => {
  const w: Workspace = {
    tabs: [
      { path: "/job-hours", params: { jobs: "1131" } },
      { path: "/job-hours", params: { jobs: "1105" } },
    ],
    active: 0,
    split: null,
  };
  const q = encodeWorkspace(w);
  assert.match(q, /t0\.jobs=1131/);
  assert.match(q, /t1\.jobs=1105/);
  const back = decodeWorkspace(Object.fromEntries(new URLSearchParams(q)));
  assert.equal(back.tabs[0].params.jobs, "1131");
  assert.equal(back.tabs[1].params.jobs, "1105");
});

test("the commonest workspace carries no URL noise", () => {
  const q = encodeWorkspace(ws(["/etc"]));
  assert.ok(!q.includes("a="), "active 0 is the default");
  assert.ok(!q.includes("s="), "no split");
  assert.ok(!q.includes("r="));
});

test("decoding is total — no URL can produce a blank app or a dangling index", () => {
  assert.deepEqual(decodeWorkspace({}), EMPTY_WORKSPACE);
  assert.deepEqual(decodeWorkspace({ t: "" }), EMPTY_WORKSPACE);
  // Empty segments must not become Dashboard tabs: normalizePath("") returns "/",
  // which IS a real route, so they are dropped before normalizing rather than after.
  assert.deepEqual(decodeWorkspace({ t: ",," }), EMPTY_WORKSPACE);
  assert.deepEqual(decodeWorkspace({ t: "/etc,,/jobs" }).tabs.map((t) => t.path), ["/etc", "/jobs"]);
  // Unknown routes are dropped, the rest survive.
  assert.deepEqual(decodeWorkspace({ t: "/etc,/nope,/jobs" }).tabs.map((t) => t.path), ["/etc", "/jobs"]);
  // An out-of-range active falls back rather than pointing at nothing.
  assert.equal(decodeWorkspace({ t: "/etc", a: "9" }).active, 0);
  assert.equal(decodeWorkspace({ t: "/etc", a: "-1" }).active, 0);
  assert.equal(decodeWorkspace({ t: "/etc", a: "x" }).active, 0);
  // A split naming a tab that does not exist, or itself, is dropped.
  assert.equal(decodeWorkspace({ t: "/etc,/jobs", s: "0:5" }).split, null);
  assert.equal(decodeWorkspace({ t: "/etc,/jobs", s: "1:1" }).split, null);
  assert.equal(decodeWorkspace({ t: "/etc,/jobs", s: "junk" }).split, null);
  // A bad ratio falls back to the default rather than to an edge.
  assert.equal(decodeWorkspace({ t: "/etc,/jobs", s: "0:1", r: "nope" }).split!.ratio, 50);
  // More tabs than the cap are truncated, not rejected.
  assert.equal(
    decodeWorkspace({ t: Array(20).fill("/etc").join(",") }).tabs.length <= MAX_TABS,
    true,
  );
});

test("present-but-empty params survive, because a page distinguishes them from absent", () => {
  // /job-hours reads ?jobs= (empty) as "the picker was cleared".
  const w = decodeWorkspace({ t: "/job-hours", "t0.jobs": "" });
  assert.deepEqual(w.tabs[0].params, { jobs: "" });
});

test("a tab's own href is the page it would be on alone", () => {
  assert.equal(tabHref({ path: "/etc", params: { month: "2026-08" } }), "/etc?month=2026-08");
  assert.equal(tabHref({ path: "/build-readiness", params: {} }), "/build-readiness");
});

test("workspaceHref and tab labels are what the tab bar renders", () => {
  assert.match(workspaceHref(ws(["/etc"])), /^\/w\?/);
  assert.equal(workspaceHref(EMPTY_WORKSPACE), "/w");
  assert.equal(tabLabel({ path: "/etc", params: {} }), "Monthly ETC");
  assert.equal(tabLabel({ path: "/job-hours", params: {} }), "Job Hour Details");
});
