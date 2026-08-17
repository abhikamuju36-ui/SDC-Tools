import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Projects Edit Mode: unlocking must always expose the restricted section
// columns, not only when Select All (or some other unrelated click) happens
// to trigger a server refresh ────────────────────────────────────────────────
//
// Reported bug: after entering the edit password, the Sections dropdown did
// not immediately list PM/Manufacturing/Warranty as options. ProjectsEditMode's
// enable() only refreshed the route (the one thing that can update the
// picker's available columns — see quoted/page.tsx's `visibleSections`) when
// `columnsDependOnMode` was true, which is false on a normal first unlock.
// ProjectsSectionsMenu.tsx compensated with its own untracked, unindicated
// `router.refresh()` fired when the menu was opened while editing — which
// raced with the ALREADY-tracked navigation `useDraftParamsMenu` fires when
// the user ticks a checkbox or clicks Select All in whatever section WAS
// available, making it look like that click revealed unrelated columns in
// another section.
//
// Fix: enable() refreshes unconditionally, and the compensating fetch-on-open
// in ProjectsSectionsMenu.tsx is gone. No React test renderer exists in this
// repo (see job-procurement-collapse.test.ts and friends) — this pins down
// the source shape so neither half of the old pattern comes back.

const SRC = join(import.meta.dirname, "..", "src");

function code(path: string): string {
  const raw = readFileSync(path, "utf8");
  return raw
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*$/gm, "")
    .replace(/\/\/[^\n"'`]*$/gm, "");
}

const EDIT_MODE = code(join(SRC, "components", "ProjectsEditMode.tsx"));
const SECTIONS_MENU = code(join(SRC, "components", "ProjectsSectionsMenu.tsx"));

test("enable() refreshes unconditionally — column availability can't depend on what's already selected", () => {
  const enableFn = EDIT_MODE.slice(EDIT_MODE.indexOf("function enable()"), EDIT_MODE.indexOf("async function disable()"));
  assert.match(enableFn, /startTransition\(\(\) => router\.refresh\(\)\);/, "enable() must call router.refresh() every time, not conditionally");
  assert.doesNotMatch(
    enableFn,
    /if\s*\(\s*columnsDependOnMode\s*\)/,
    "enable() must not gate its refresh on columnsDependOnMode — that's exactly what let a fresh unlock skip refreshing the Sections picker's available columns",
  );
});

test("disable() may still skip its refresh when nothing rendered actually depends on the mode", () => {
  const disableFn = EDIT_MODE.slice(EDIT_MODE.indexOf("async function disable()"));
  assert.match(
    disableFn,
    /if\s*\(\s*columnsDependOnMode\s*\)\s*startTransition\(\(\) => router\.refresh\(\)\);/,
    "disable() intentionally keeps the conditional refresh — turning editing off only needs a server round trip if a restricted column is actually on screen to remove",
  );
});

test("ProjectsSectionsMenu no longer fires its own router.refresh() on open", () => {
  assert.doesNotMatch(
    SECTIONS_MENU,
    /router\.refresh\(\)/,
    "the menu must not compensate for a missed refresh itself — that untracked call is what raced with Select All's own navigation and looked like it revealed unrelated columns",
  );
  assert.doesNotMatch(SECTIONS_MENU, /from ["']next\/navigation["']/, "no reason left to import useRouter here once the fetch-on-open is gone");
});

test("the Sections button reflects edit-mode's own pending state, not only its own draft-apply pending", () => {
  assert.match(
    SECTIONS_MENU,
    /useProjectsEditMode\(\)/,
    "must read ProjectsEditMode's pending so the button visibly shows \"still catching up\" right after unlocking, not just after its own cols/hide ticks",
  );
});

test("setPhase only ever touches its own phase's codes — Select All under one section must never reach into another's", () => {
  const setPhaseFn = SECTIONS_MENU.slice(SECTIONS_MENU.indexOf("function setPhase"), SECTIONS_MENU.indexOf("return (", SECTIONS_MENU.indexOf("function setPhase")));
  assert.match(setPhaseFn, /const phaseCodes = spec\.sections\.map/, "must derive the codes to add/remove from THIS call's own phase spec");
  assert.match(setPhaseFn, /cols\.filter\(\(c\) => !phaseCodes\.includes\(c\)\)/, "must only strip this phase's own codes out of the rest, never another phase's");
});
