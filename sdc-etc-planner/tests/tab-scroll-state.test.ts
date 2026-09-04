import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT_KEY,
  applyEntry,
  applyScrollState,
  elementForKey,
  hasScrollRoom,
  parseScrollState,
  pruneScrollState,
  scrollKeyOf,
  tabScrollStorageKey,
  type TabScrollState,
} from "../src/lib/tab-scroll-state";

// ── The reported bug ────────────────────────────────────────────────────────
//
// Scroll the Monthly ETC grid far right, switch tabs, come back — the grid is at the
// left again. The panes already stay mounted behind <Activity>, so React state and the
// pane's own scrollTop survived; what did not is a nested `overflow-x: auto` div, because
// Activity hides a pane with `display: none` and an element with no layout box has no
// scroll box for the browser to keep an offset in.
//
// These tests use a tiny fake DOM rather than jsdom: everything under test is index
// arithmetic and clamping logic, and the parts that genuinely need a browser (a
// capture-phase scroll listener, requestAnimationFrame) are asserted structurally at the
// bottom instead of mocked into something that proves nothing.

type FakeEl = {
  children: FakeEl[];
  parentElement: FakeEl | null;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  attrs: Record<string, string>;
  getAttribute(name: string): string | null;
  querySelector(selector: string): FakeEl | null;
};

function el(opts: Partial<FakeEl> = {}): FakeEl {
  const node: FakeEl = {
    children: [],
    parentElement: null,
    scrollLeft: 0,
    scrollTop: 0,
    scrollWidth: 100,
    clientWidth: 100,
    scrollHeight: 100,
    clientHeight: 100,
    attrs: {},
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    },
    querySelector(selector: string) {
      return fakeQuerySelector(this, selector);
    },
    ...opts,
  };
  return node;
}

// The declared-key path resolves through querySelector + CSS.escape. Both are real
// browser APIs the lib is right to use, so the harness provides them rather than the lib
// avoiding them: a fake that forced the lib to be less capable would be testing the
// wrong code.
const CSSShim = { escape: (v: string) => v };
(globalThis as unknown as { CSS?: typeof CSSShim }).CSS ??= CSSShim;

/** Walk a fake subtree for `[data-scroll-key="…"]`, which is all the lib asks of it. */
function fakeQuerySelector(root: FakeEl, selector: string): FakeEl | null {
  const want = /^\[data-scroll-key="(.*)"\]$/.exec(selector)?.[1];
  if (want === undefined) return null;
  const stack = [...root.children];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.getAttribute("data-scroll-key") === want) return node;
    stack.push(...node.children);
  }
  return null;
}

function tree(root: FakeEl, ...kids: FakeEl[]): FakeEl {
  for (const k of kids) {
    k.parentElement = root;
    root.children.push(k);
  }
  return root;
}

// The lib takes Element/HTMLElement; the fakes above implement exactly the surface it
// touches. One cast at the boundary rather than a fake DOM library.
const as = <T,>(x: unknown) => x as T;

// ── Keys ───────────────────────────────────────────────────────────────────

test("a declared key wins, because it survives the tree changing shape", () => {
  const target = el({ attrs: { "data-scroll-key": "etc-grid" } });
  const root = tree(el(), el(), tree(el(), target));
  assert.equal(scrollKeyOf(as(target), as(root)), "@etc-grid");
});

test("without one, the key is the path of child indices from the pane root", () => {
  const target = el();
  const mid = tree(el(), el(), target);
  const root = tree(el(), el(), mid);
  // root -> child 1 -> child 1
  assert.equal(scrollKeyOf(as(target), as(root)), "1/1");
});

test("the pane container itself is the empty key", () => {
  const root = el();
  assert.equal(scrollKeyOf(as(root), as(root)), ROOT_KEY);
  assert.equal(ROOT_KEY, "");
});

test("a path round-trips back to the same element", () => {
  const target = el();
  const root = tree(el(), tree(el(), el(), target), el());
  const key = scrollKeyOf(as(target), as(root));
  assert.equal(elementForKey(as(root), key), target);
});

test("a path that no longer resolves is skipped, never applied to the wrong element", () => {
  // After a reload the DOM is rebuilt, and a saved path can point at something that is
  // not there any more. Losing a position is acceptable; scrolling an unrelated
  // container to a remembered offset is not.
  const root = tree(el(), el());
  assert.equal(elementForKey(as(root), "5/2"), null);
  assert.equal(elementForKey(as(root), "0/0"), null);
});

// ── Applying, and the silent-zero failure ──────────────────────────────────

test("an offset applies when the content is laid out", () => {
  const target = el({ scrollWidth: 3000, clientWidth: 800, scrollHeight: 5000, clientHeight: 600 });
  assert.equal(applyEntry(as(target), { left: 1800, top: 2400 }), true);
  assert.equal(target.scrollLeft, 1800);
  assert.equal(target.scrollTop, 2400);
});

test("an offset that cannot be applied yet reports FAILURE rather than a silent zero", () => {
  // The failure the report warned about: "setting scrollLeft too early may silently
  // reset to 0". A grid whose columns have not been measured has scrollWidth ===
  // clientWidth, so the assignment clamps to 0 and reads back 0 — and the only way to
  // know is to read it back.
  const notReady = el({ scrollWidth: 800, clientWidth: 800, scrollHeight: 600, clientHeight: 600 });
  // Simulate the browser clamping: nothing to scroll, so the write does not take.
  Object.defineProperty(notReady, "scrollLeft", {
    get: () => 0,
    set: () => {},
    configurable: true,
  });
  assert.equal(applyEntry(as(notReady), { left: 1800, top: 0 }), false, "must report that it did not stick");
});

test("a legitimately clamped offset counts as applied, so it is not retried forever", () => {
  // Saved 900 against a scroller that only reaches 850 — 850 IS the right answer, and
  // retrying it every frame until the cap would just burn frames.
  const target = el({ scrollWidth: 1650, clientWidth: 800, scrollHeight: 600, clientHeight: 600 });
  let left = 0;
  Object.defineProperty(target, "scrollLeft", {
    get: () => left,
    set: (v: number) => {
      left = Math.min(v, 850);
    },
    configurable: true,
  });
  assert.equal(applyEntry(as(target), { left: 900, top: 0 }), true);
  assert.equal(target.scrollLeft, 850);
});

test("applyScrollState returns exactly the keys that did not stick", () => {
  const ready = el({ scrollWidth: 3000, clientWidth: 500 });
  const notReady = el({ scrollWidth: 500, clientWidth: 500 });
  Object.defineProperty(notReady, "scrollLeft", { get: () => 0, set: () => {}, configurable: true });
  const root = tree(el(), ready, notReady);
  const pending = applyScrollState(as(root), { "0": { left: 1200, top: 0 }, "1": { left: 900, top: 0 } });
  assert.deepEqual(pending, ["1"]);
  assert.equal(ready.scrollLeft, 1200);
});

test("a zero entry is not applied at all — there is nothing to restore", () => {
  const target = el({ scrollWidth: 3000, clientWidth: 500, scrollLeft: 777 });
  const root = tree(el(), target);
  applyScrollState(as(root), { "0": { left: 0, top: 0 } });
  assert.equal(target.scrollLeft, 777, "restoring a zero must not scroll a container to the start");
});

// ── Storage ────────────────────────────────────────────────────────────────

test("the store is keyed by TAB INSTANCE, not by page type", () => {
  // "Monthly ETC tab A → own state, Monthly ETC tab B → own state." Two Monthly ETC
  // tabs on the same month with the same filters must still not share a position, which
  // is why this keys on the tab id rather than the route.
  assert.notEqual(tabScrollStorageKey("t1"), tabScrollStorageKey("t2"));
  assert.ok(tabScrollStorageKey("t1").includes("t1"));
});

test("duplicate tabs of one page keep separate state", () => {
  // Job Details A on job 1101 scrolled halfway; Job Details B on 1164 at the top.
  const a: TabScrollState = { "@parts-list": { left: 0, top: 4200 } };
  const b: TabScrollState = {};
  assert.notDeepEqual(a, b);
  assert.notEqual(tabScrollStorageKey("t3"), tabScrollStorageKey("t4"));
  // And restoring B's (empty) state cannot move A's scroller.
  const scroller = el({ scrollWidth: 9000, clientHeight: 600, scrollHeight: 9000, scrollTop: 4200 });
  const root = tree(el(), scroller);
  applyScrollState(as(root), b);
  assert.equal(scroller.scrollTop, 4200);
});

test("zero offsets are pruned, so a never-scrolled tab stores nothing", () => {
  assert.deepEqual(pruneScrollState({ "": { left: 0, top: 0 }, "1": { left: 0, top: 300 } }), {
    "1": { left: 0, top: 300 },
  });
  assert.deepEqual(pruneScrollState({}), {});
});

test("a malformed stored value reads as nothing saved, never as a position", () => {
  for (const raw of [null, "", "not json", "[]", '"x"', "42", '{"a":null}', '{"a":{"left":"x","top":1}}']) {
    assert.deepEqual(parseScrollState(raw), {}, `${JSON.stringify(raw)} should yield nothing`);
  }
  // Negative and non-finite are refused rather than clamped: they cannot have come from
  // a real scroller, so the entry is corrupt.
  assert.deepEqual(parseScrollState('{"a":{"left":-5,"top":0}}'), {});
  assert.deepEqual(parseScrollState('{"a":{"left":1e999,"top":0}}'), {});
  // A good entry beside a bad one survives.
  assert.deepEqual(parseScrollState('{"a":{"left":-5,"top":0},"@etc-grid":{"left":1800,"top":2400}}'), {
    "@etc-grid": { left: 1800, top: 2400 },
  });
});

test("hasScrollRoom ignores a one-pixel rounding difference", () => {
  assert.equal(hasScrollRoom(as(el({ scrollWidth: 801, clientWidth: 800 }))), false);
  assert.equal(hasScrollRoom(as(el({ scrollWidth: 900, clientWidth: 800 }))), true);
  assert.equal(hasScrollRoom(as(el({ scrollHeight: 2000, clientHeight: 600 }))), true);
});

// ── The acceptance case from the report ────────────────────────────────────

test("the acceptance test: Monthly ETC far right, deep down, and back", () => {
  // "Scroll horizontally to Parts Cost / Standard Sheet, vertically to about job 40,
  // switch to Job Details, return — the exact same position."
  const grid = el({
    attrs: { "data-scroll-key": "etc-grid" },
    scrollWidth: 7400,
    clientWidth: 1400,
    scrollHeight: 2600,
    clientHeight: 780,
  });
  const pane = tree(el({ scrollHeight: 1200, clientHeight: 780 }), tree(el(), grid));

  // Scrolled far right and well down.
  grid.scrollLeft = 5200;
  grid.scrollTop = 1830;
  const captured: TabScrollState = {
    [scrollKeyOf(as(grid), as(pane))]: { left: grid.scrollLeft, top: grid.scrollTop },
  };
  assert.deepEqual(Object.keys(captured), ["@etc-grid"]);

  // Hidden with display:none — the browser drops the offsets, which IS the bug.
  grid.scrollLeft = 0;
  grid.scrollTop = 0;

  // Shown again.
  assert.deepEqual(applyScrollState(as(pane), captured), [], "nothing should still be pending");
  assert.equal(grid.scrollLeft, 5200);
  assert.equal(grid.scrollTop, 1830);
});

test("switching rapidly cannot corrupt the record", () => {
  // Capture/restore is idempotent: restoring, re-capturing and restoring again lands on
  // the same numbers, so a fast switch back and forth cannot drift.
  const grid = el({ attrs: { "data-scroll-key": "etc-grid" }, scrollWidth: 7400, clientWidth: 1400 });
  const pane = tree(el(), grid);
  const state: TabScrollState = { "@etc-grid": { left: 5200, top: 0 } };
  for (let i = 0; i < 5; i++) {
    grid.scrollLeft = 0;
    applyScrollState(as(pane), state);
    state["@etc-grid"] = { left: grid.scrollLeft, top: grid.scrollTop };
  }
  assert.deepEqual(state["@etc-grid"], { left: 5200, top: 0 });
});

// ── Structural: the parts a fake DOM cannot prove ─────────────────────────

const COMPONENT = readFileSync(join(process.cwd(), "src", "components", "TabScrollMemory.tsx"), "utf8");

test("one CAPTURE-phase listener per pane, which is what makes this general", () => {
  // A scroll event does not bubble, so a plain listener on the pane would only ever see
  // the pane. A capture listener sees every scroller nested anywhere inside it — which
  // is why no page needs to know it is inside a tab, and why a scroller added to any
  // page later is covered the day it is added.
  assert.match(COMPONENT, /addEventListener\("scroll", onScroll, \{ capture: true, passive: true \}\)/);
  assert.match(COMPONENT, /removeEventListener\("scroll", onScroll, \{ capture: true \}\)/);
});

test("the restore retries across frames instead of trusting the first attempt", () => {
  assert.match(COMPONENT, /requestAnimationFrame\(restore\)/);
  assert.match(COMPONENT, /const pending = applyScrollState\(root, state\.current\)/);
  assert.match(COMPONENT, /pending\.length === 0 \|\| frame >= MAX_RESTORE_FRAMES/, "and gives up rather than spinning");
  // In a LAYOUT effect, so the position is set before paint — a scroll set in a plain
  // effect is visible as a jump from the start.
  assert.match(COMPONENT, /useLayoutEffect\(\(\) => \{/);
});

test("the cleanup can never overwrite a remembered offset with a zero", () => {
  // If React has already applied display:none by the time the cleanup runs, every read
  // is 0. That is exactly why the recording is continuous and the cleanup only ADDS
  // non-zero values.
  assert.match(COMPONENT, /if \(node\.scrollLeft !== 0 \|\| node\.scrollTop !== 0\)/);
});

test("storage is seeded once, so a re-show cannot undo a newer position", () => {
  assert.match(COMPONENT, /if \(!loaded\.current\)/);
});

// ── Every page's big scroller is named ────────────────────────────────────

test("the grids worth not losing carry a stable key", () => {
  // The structural path is enough for a hide-and-show, but a re-render that changes the
  // tree above a scroller would invalidate it. The major grids are named so their
  // positions survive that too.
  const expected: Record<string, string> = {
    "src/app/(app)/etc/page.tsx": "etc-grid",
    "src/app/(app)/quoted/page.tsx": "projects-grid",
    "src/components/JobCostExplorer.tsx": "profitability-grid",
  };
  for (const [file, key] of Object.entries(expected)) {
    const src = readFileSync(join(process.cwd(), ...file.split("/")), "utf8");
    assert.ok(src.includes(key), `${file} should name its scroller "${key}"`);
  }
  const procurement = readFileSync(join(process.cwd(), "src", "components", "JobProcurement.tsx"), "utf8");
  for (const key of ["parts-list", "assemblies-tree"]) {
    assert.ok(procurement.includes(`scrollKey="${key}"`), `the Parts List card should name "${key}"`);
  }
});

test("DragScroll passes a declared key through to the element that actually scrolls", () => {
  // The overflow lives on DragScroll's own element, so the attribute has to land there —
  // on a wrapper it would name something whose scrollLeft is always 0.
  const drag = readFileSync(join(process.cwd(), "src", "components", "DragScroll.tsx"), "utf8");
  const scroller = drag.slice(drag.indexOf("className={className}"));
  assert.match(scroller.slice(0, 200), /data-scroll-key=\{scrollKey\}/);
});

test("no page keeps its own scroll-restore code beside this one", () => {
  // The failure mode this prevents: two mechanisms both setting scrollLeft on the same
  // element, where whichever runs second wins and the bug looks intermittent.
  const app = join(process.cwd(), "src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) files.push(full);
    }
  };
  walk(app);
  const offenders = files
    .filter((f) => !f.endsWith("TabScrollMemory.tsx") && !f.endsWith("tab-scroll-state.ts") && !f.endsWith("DragScroll.tsx"))
    .filter((f) => /\.\s*scrollLeft\s*=/.test(readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, "")))
    .map((f) => f.replace(process.cwd(), "").split("\\").join("/"));
  assert.deepEqual(offenders, [], `these set scrollLeft themselves:\n  ${offenders.join("\n  ")}`);
});
