import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_KEY,
  ZOOM_STEPS,
  ZOOM_VAR,
  isMaxZoom,
  isMinZoom,
  snapZoom,
  stepZoom,
  zoomLabel,
} from "../src/lib/app-zoom";

// ── One universal zoom (§45) ────────────────────────────────────────────────
//
// §45 replaced six independent size controls — a root font-size stepper in the sidebar
// and, per grid, a font size box and Row height / Column width steppers — with one
// `zoom` on <html>. What these tests guard is not the arithmetic (that is four lines)
// but the four ways the replacement could silently come undone:
//
//   1. a step list that no longer contains its own default or its own limits;
//   2. the pre-paint script's clamp drifting from ZOOM_STEPS, so a saved level is
//      quietly clamped away on load;
//   3. a new component reaching for a raw `vh`/`vw`, which `zoom` does not correct —
//      the one genuine trap in the whole approach;
//   4. a second size control appearing somewhere, which is exactly the state §45
//      exists to end.

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(path);
  }
  return out;
}
const FILES = walk(SRC);
const COMPONENT_FILES = FILES.filter((f) => /\.tsx?$/.test(f));
const CSS = readFileSync(join(SRC, "app", "globals.css"), "utf8");

// Comments are stripped before searching: several of them quote the units and controls
// they replaced, and a guard that trips on its own documentation is a guard people delete.
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*$/gm, "")
    .replace(/\/\/[^\n"'`]*$/gm, "");
}

// ── The step list (§45: "consistent increments", "safe minimum and maximum") ─

test("the offered levels are the ones §45 asks for, in order", () => {
  assert.deepEqual([...ZOOM_STEPS], [0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5]);
  const sorted = [...ZOOM_STEPS].sort((a, b) => a - b);
  assert.deepEqual([...ZOOM_STEPS], sorted, "stepZoom walks this list by index, so it must be ordered");
});

test("the default is 100% and it is one of the offered levels", () => {
  // §45: "The default must be 100%." If it were not IN the list, stepping away from it
  // and back would be impossible — snapZoom would round it to a neighbour first.
  assert.equal(DEFAULT_ZOOM, 1);
  assert.ok(ZOOM_STEPS.includes(DEFAULT_ZOOM));
});

test("the limits are the ends of the list, so there is no second source of bounds", () => {
  assert.equal(MIN_ZOOM, 0.75);
  assert.equal(MAX_ZOOM, 1.5);
  assert.equal(MIN_ZOOM, Math.min(...ZOOM_STEPS));
  assert.equal(MAX_ZOOM, Math.max(...ZOOM_STEPS));
});

// ── Snapping (§45: the app must never render at an unusable size) ────────────

test("anything unusable lands on the default rather than on screen", () => {
  // localStorage is user-writable and survives releases. Every one of these is a value
  // the app could actually be handed.
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, "", "abc", {}, []]) {
    assert.equal(snapZoom(bad), DEFAULT_ZOOM, `${JSON.stringify(bad)} must fall back to the default`);
  }
});

test("out-of-range values clamp to the limits instead of applying", () => {
  // 0.02 would make the app unreadable; 8 would show four cells. Neither is reachable —
  // and note these clamp rather than falling back to the default: a hand-edited 8 means
  // "as large as possible", and 150% is that.
  assert.equal(snapZoom(0.02), MIN_ZOOM);
  assert.equal(snapZoom("1e-9"), MIN_ZOOM);
  assert.equal(snapZoom(-3), MIN_ZOOM);
  assert.equal(snapZoom(8), MAX_ZOOM);
});

test("a level retired in a later release snaps to its nearest survivor", () => {
  // The upgrade path: someone saved 95% or 135% while that step existed. They get the
  // closest offered level, not the default and not a crash.
  assert.equal(snapZoom(0.95), 0.9);
  assert.equal(snapZoom(1.35), 1.25);
  assert.equal(snapZoom(1.02), 1);
});

test("every offered level snaps to itself", () => {
  // The round-trip that matters: applied -> persisted as a string -> read back.
  for (const step of ZOOM_STEPS) {
    assert.equal(snapZoom(step), step);
    assert.equal(snapZoom(String(step)), step, "persisted values come back as strings");
  }
});

// ── Stepping (§45: the two sidebar buttons) ─────────────────────────────────

test("stepping walks the list one level at a time, both ways", () => {
  for (let i = 0; i < ZOOM_STEPS.length - 1; i++) {
    assert.equal(stepZoom(ZOOM_STEPS[i], 1), ZOOM_STEPS[i + 1]);
    assert.equal(stepZoom(ZOOM_STEPS[i + 1], -1), ZOOM_STEPS[i]);
  }
});

test("stepping stops at the ends instead of wrapping or overflowing", () => {
  // Wrapping would take someone who clicked − once too often from 75% to 150%.
  assert.equal(stepZoom(MIN_ZOOM, -1), MIN_ZOOM);
  assert.equal(stepZoom(MAX_ZOOM, 1), MAX_ZOOM);
  assert.ok(isMinZoom(stepZoom(MIN_ZOOM, -1)), "the − button must report itself disabled there");
  assert.ok(isMaxZoom(stepZoom(MAX_ZOOM, 1)), "the + button must report itself disabled there");
});

test("stepping from an off-list value joins the list rather than compounding the error", () => {
  // It snaps FIRST, then steps — so an off-list value takes one click to become an
  // offered level and stays on the list from then on.
  assert.equal(stepZoom(0.86, 1), 1); // 0.86 -> 0.9 -> up one
  assert.equal(stepZoom(0.86, -1), 0.8);
  assert.equal(stepZoom(0.97, 1), 1.1); // 0.97 -> 1 -> up one
});

test("every level reads as a whole percentage", () => {
  // §45 shows the level as text in a 2.6rem slot. "112.5%" would not fit and would not
  // be a level anyone chose.
  for (const step of ZOOM_STEPS) {
    const label = zoomLabel(step);
    assert.match(label, /^\d{2,3}%$/, `${step} formatted as ${label}`);
    // Rounded, and it has to be: `1.1 * 100` is 110.00000000000001 in binary floating
    // point, which is why zoomLabel rounds rather than interpolating the raw product.
    assert.equal(label, `${Math.round(step * 100)}%`);
  }
  assert.equal(zoomLabel(DEFAULT_ZOOM), "100%");
});

// ── The pre-paint restore (§45: "apply it immediately", no flash) ────────────

test("the pre-paint script and the step list agree on the key, the variable and the bounds", () => {
  // The script is a string in layout.tsx, so it cannot import any of this. If the range
  // is ever widened here and not there, a saved 175% would be silently clamped to 150%
  // on every load — the app would just quietly disagree with its own control.
  const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");
  const script = layout.slice(layout.indexOf("dangerouslySetInnerHTML"));
  assert.ok(script.includes(`'${ZOOM_KEY}'`), `the script must read ${ZOOM_KEY}`);
  assert.ok(script.includes(`'${ZOOM_VAR}'`), `the script must write ${ZOOM_VAR}`);
  assert.ok(script.includes(`Math.min(${MAX_ZOOM},`), `the script's upper clamp must be ${MAX_ZOOM}`);
  assert.ok(script.includes(`Math.max(${MIN_ZOOM},`), `the script's lower clamp must be ${MIN_ZOOM}`);
});

test("the zoom is applied by CSS reading one variable, with a 1 default", () => {
  // Why it must be declared in CSS: applyZoom only ever writes the custom property, so a
  // browser that has never had a preference set — and the server-rendered first paint —
  // needs the stylesheet to supply the 1. And `html { zoom: var(…) }` is what makes
  // changing the level a single property write rather than a re-render (§45's "do not
  // rerender every table cell").
  assert.match(CSS, /--app-zoom:\s*1;/, "globals.css must declare the default zoom");
  assert.match(CSS, /html\s*\{[^}]*zoom:\s*var\(--app-zoom\)/, "html must apply it");
});

test("the viewport vars divide the zoom back out", () => {
  // The trap measured before any of this was written: `zoom` scales `vh`, but the viewport
  // does not scale, so at 125% a `height: 100vh` element renders 900px against a 720px
  // viewport. These two vars are the correction, and the test below is what keeps them the
  // only way viewport lengths are written.
  assert.match(CSS, /--app-vh:\s*calc\(100vh\s*\/\s*var\(--app-zoom\)\)/);
  assert.match(CSS, /--app-vw:\s*calc\(100vw\s*\/\s*var\(--app-zoom\)\)/);
});

test("no component uses a raw viewport unit", () => {
  // The trap above, guarded. `h-screen`, `min-h-screen` and `max-h-[80vh]` all LOOK
  // correct and all break at any zoom other than 100% — the sidebar hanging off the
  // bottom of the screen at 125% is what this catches.
  const offenders: string[] = [];
  for (const file of COMPONENT_FILES) {
    const body = code(file);
    for (const m of body.matchAll(/\b(?:min-|max-)?[hw]-screen\b/g)) offenders.push(`${file.replace(SRC, "src")}: ${m[0]}`);
    // A vh/vw inside an arbitrary value or an inline style. --app-vh/--app-vw are
    // themselves defined in globals.css, which is not a component file.
    for (const m of body.matchAll(/[\d.]+(?:vh|vw)\b/g)) offenders.push(`${file.replace(SRC, "src")}: ${m[0]}`);
  }
  assert.deepEqual(offenders, [], "use var(--app-vh) / var(--app-vw) — `zoom` does not correct raw viewport units");
});

// ── One control, and only one (§45's acceptance criteria 1-8) ────────────────

test("nothing but the zoom control writes a size onto the document root", () => {
  // Criteria 2-6: the separate text-size, font-size, row-height, column-width and
  // density controls are gone. They all worked the same way — a custom property or the
  // font-size on <html>, plus a localStorage key and a mount effect to restore it — so
  // the way to keep them gone is to allow exactly one file to do that at all.
  //
  // Two files may: app-zoom.ts, which owns the property, and layout.tsx's pre-paint
  // script, which cannot import it (it is a string in the HTML). The test above pins
  // that script to app-zoom's own key, variable and bounds, so it is not a second
  // opinion about zoom — it is the same one, spelled out for the parser.
  const allowed = new Set(["src\\lib\\app-zoom.ts", "src/lib/app-zoom.ts", "src\\app\\layout.tsx", "src/app/layout.tsx"]);
  const offenders: string[] = [];
  for (const file of COMPONENT_FILES) {
    if (allowed.has(file.replace(SRC, "src"))) continue;
    if (/documentElement\.style/.test(code(file))) offenders.push(file.replace(SRC, "src"));
  }
  assert.deepEqual(offenders, [], "size the app through lib/app-zoom.ts, not by writing to <html> directly");
});

test("the retired density variables are referenced nowhere", () => {
  // Criteria 4-6 again, from the consuming end: the two grids' padding used to read
  // --etc-row-py / --etc-col-px / --etc-font-size and --quoted-row-py / --quoted-col-px.
  // A leftover reference is worse than a leftover control — it is a var nothing sets, so
  // it silently falls back and reads as if it still worked.
  const retired = ["--etc-row-py", "--etc-col-px", "--etc-font-size", "--quoted-row-py", "--quoted-col-px"];
  const offenders: string[] = [];
  for (const file of FILES) {
    const body = code(file);
    for (const name of retired) if (body.includes(name)) offenders.push(`${file.replace(SRC, "src")}: ${name}`);
  }
  assert.deepEqual(offenders, [], "these were the per-grid density controls (§45)");
});

test("the zoom control lives in the sidebar, so it is on every page", () => {
  // Criteria 1 and 8: one control, reachable from everywhere, and the same level on every
  // tab. The sidebar is the only chrome every route shares — a toolbar control would be
  // per-page by construction, which is how the app came to have two densities at once.
  const sidebar = readFileSync(join(SRC, "components", "Sidebar.tsx"), "utf8");
  assert.match(sidebar, /<AppZoom\b/, "Sidebar must render the zoom control");
  // Matched inside the tag rather than with the `s` flag, which this tsconfig's target
  // does not allow: the control has to be TOLD about the rail, or it cannot stay usable there.
  assert.match(sidebar, /<AppZoom[^>]*collapsed/, "it must stay usable on the collapsed rail");

  const consumers = COMPONENT_FILES.filter((f) => /<AppZoom\b/.test(code(f)));
  assert.deepEqual(
    consumers.map((f) => f.replace(SRC, "src")),
    [join("src", "components", "Sidebar.tsx")],
    "exactly one place may render it",
  );
});
