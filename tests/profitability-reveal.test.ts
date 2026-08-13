import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROJECTS_GESTURE_CLICKS,
  PROJECTS_GESTURE_WINDOW_MS,
  noteOtherNavClick,
  noteProjectsClick,
  readProfitabilityRevealed,
  resetProfitabilityRevealForTest,
  serverProfitabilityRevealed,
  subscribeProfitabilityReveal,
} from "../src/lib/profitability-reveal";

// ── Profitability hidden by default, revealed by three Projects clicks (§84) ──
//
// Same shape as tests/standards-reveal.test.ts, for the sibling gesture: a
// module-level streak + store, verified as real behaviour (this module has no
// DOM/React dependency, so it is a plain unit test) plus a handful of
// source-shape checks pinning down how Sidebar.tsx must wire it — in
// particular that, unlike the Monthly ETC double-click, this gesture must
// NEVER suppress the navigation each counting click already causes.

const SRC = join(import.meta.dirname, "..", "src");
function code(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*$/gm, "")
    .replace(/\/\/[^\n"'`]*$/gm, "");
}
const SIDEBAR = code("components", "Sidebar.tsx");

beforeEach(() => resetProfitabilityRevealForTest());

// ── The gesture ─────────────────────────────────────────────────────────────

test("the gesture is three clicks inside a short window", () => {
  assert.equal(PROJECTS_GESTURE_CLICKS, 3);
  assert.ok(PROJECTS_GESTURE_WINDOW_MS >= 1000, "long enough for three unhurried clicks");
  assert.ok(PROJECTS_GESTURE_WINDOW_MS <= 3000, "…but short enough that normal navigation never trips it");
});

test("one or two clicks reveal nothing; the third does", () => {
  noteProjectsClick();
  assert.equal(readProfitabilityRevealed(), false);
  noteProjectsClick();
  assert.equal(readProfitabilityRevealed(), false);
  noteProjectsClick();
  assert.equal(readProfitabilityRevealed(), true);
});

test("repeated clicks past the threshold do not double-notify", () => {
  let notifications = 0;
  subscribeProfitabilityReveal(() => notifications++);
  for (let i = 0; i < 10; i++) noteProjectsClick();
  assert.equal(readProfitabilityRevealed(), true);
  // Ten clicks cross the threshold once; `reveal()` returns early once already
  // revealed, so subscribers are woken exactly once, not every click after.
  assert.equal(notifications, 1, `expected one state change, got ${notifications}`);
});

test("the streak survives being read again but resets after the window elapses", async () => {
  noteProjectsClick();
  noteProjectsClick();
  await new Promise((r) => setTimeout(r, PROJECTS_GESTURE_WINDOW_MS + 80));
  noteProjectsClick(); // fresh streak of one, not the third of the earlier pair
  assert.equal(readProfitabilityRevealed(), false);
});

test("a click on another nav item breaks the streak — 'consecutive' means it", () => {
  noteProjectsClick();
  noteProjectsClick();
  noteOtherNavClick(); // e.g. Employees, Monthly ETC, Hours…
  noteProjectsClick();
  assert.equal(readProfitabilityRevealed(), false, "two clicks, an interruption, and one more must not equal three in a row");
});

test("the server snapshot is always hidden", () => {
  // Rendered for every visitor on first paint; a truthy snapshot would reveal
  // Profitability to everyone before any gesture ever ran.
  assert.equal(serverProfitabilityRevealed(), false);
  noteProjectsClick();
  noteProjectsClick();
  noteProjectsClick();
  assert.equal(readProfitabilityRevealed(), true, "sanity check: the client did reveal");
  assert.equal(serverProfitabilityRevealed(), false, "…but the server snapshot never does");
});

// ── Sidebar wiring ────────────────────────────────────────────────────────────

test("Sidebar hides Profitability unless the reveal store says otherwise", () => {
  assert.match(
    SIDEBAR,
    /profitabilityRevealed\s*\?\s*baseGroups\s*:\s*baseGroups\.map\(\(g\) => \(\{ \.\.\.g, items: g\.items\.filter\(\(i\) => i\.href !== PROFITABILITY_HREF\) \}\)\)/,
    "Profitability must be filtered OUT of the array (not hidden with CSS) whenever the store says unrevealed",
  );
  assert.match(SIDEBAR, /useSyncExternalStore\(subscribeProfitabilityReveal, readProfitabilityRevealed, serverProfitabilityRevealed\)/);
});

test("Projects clicks feed the gesture; every other nav item breaks it", () => {
  const handler = SIDEBAR.slice(SIDEBAR.indexOf("function handleNavClick"), SIDEBAR.indexOf("function handleNavClick") + 800);
  assert.match(handler, /if \(href === "\/quoted"\) noteProjectsClick\(\);/);
  assert.match(handler, /else noteOtherNavClick\(\);/);
});

test("the gesture never suppresses navigation, unlike the Monthly ETC double-click", () => {
  // Contrast handleEtcClick, which calls e.preventDefault() to stop the click it is
  // counting from navigating. Clicking Projects three times must mean going to
  // Projects three genuine times — the reveal is a side effect beside the
  // navigation, never a replacement for it.
  const handler = SIDEBAR.slice(SIDEBAR.indexOf("function handleNavClick"), SIDEBAR.indexOf("function handleNavClick") + 800);
  const projectsLine = handler.slice(handler.indexOf('if (href === "/quoted")'));
  assert.doesNotMatch(projectsLine.slice(0, 120), /preventDefault/, "the Projects branch must not suppress the click's own navigation");
});

test("the route itself is untouched — Profitability keeps its own href and gate", () => {
  // This feature is UI visibility only (§84's own requirement): the nav item still
  // points at the real route, so hiding the link changes nothing about what
  // authenticates a direct URL visit.
  assert.match(SIDEBAR, /const PROFITABILITY_HREF = "\/job-cost-explorer";/);
  assert.match(SIDEBAR, /href: PROFITABILITY_HREF,\s*\n\s*label: "Profitability"/);
});
