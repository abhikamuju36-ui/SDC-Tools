import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ── One drill-through design (§47) ──────────────────────────────────────────
//
// The "KPI Card Redesign" reference was applied to every drill-through in the app. What
// these tests guard is not the styling — that is one file now — but the three ways it
// comes undone:
//
//   1. a panel hand-rolling its own header band, zebra stripes or total row again, which
//      is the state the redesign found (three drills, three designs, agreeing on none of
//      five decisions);
//   2. the muted text tone going undeclared again, which is what made the whole second
//      tier of the hierarchy render at full body ink for 107 call sites;
//   3. the mockup's palette or its sub-AA greys being copied in alongside the brand
//      tokens.

const SRC = join(import.meta.dirname, "..", "src");
const CSS = readFileSync(join(SRC, "app", "globals.css"), "utf8");
const DRILL = readFileSync(join(SRC, "components", "ui", "Drill.tsx"), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}
const FILES = walk(SRC);

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*$/gm, "")
    .replace(/\/\/[^\n"'`]*$/gm, "");
}

/** The three panels the reference was applied to. */
const DRILLS = ["HoursDetailPanel.tsx", "UndefinedHoursPanel.tsx", "DataQualityDrill.tsx"].map((f) =>
  join(SRC, "components", f),
);

// ── The muted tone exists (§47) ─────────────────────────────────────────────

test("the muted text tone is declared, in both places Tailwind needs", () => {
  // The bug this replaces: `sdc-gray-500` was written 107 times and never declared, so
  // `.text-sdc-gray-500` emitted NO CSS — verified in the running app, where the class
  // matched no rule and the text inherited #231f20. Every "secondary" line in the app was
  // rendering at full body ink.
  //
  // Tailwind v4 needs the value in `:root` AND a `--color-*` alias in `@theme`, and a
  // token with only the first half is exactly as invisible as no token at all.
  assert.match(CSS, /--sdc-muted:\s*#6e6a6b/i, "the value belongs in :root");
  assert.match(CSS, /--color-sdc-muted:\s*var\(--sdc-muted\)/, "…and the alias in @theme, or no utility is generated");
});

test("the muted tone passes AA on every surface the app puts it on", () => {
  // Not decoration: these are group counts, record counts, dates and section codes.
  const lum = (hex: string) => {
    const ch = (i: number) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const muted = CSS.match(/--sdc-muted:\s*(#[0-9a-f]{6})/i)![1];
  for (const [name, bg] of [
    ["white", "#ffffff"],
    ["--sdc-gray-50", "#fafafa"],
    ["--sdc-gray-100", "#f2f2f2"],
  ] as const) {
    const r = ratio(muted, bg);
    assert.ok(r >= 4.5, `${muted} on ${name} is ${r.toFixed(2)}:1 — WCAG AA for normal text needs 4.5:1`);
  }
});

test("the undeclared token cannot come back", () => {
  const offenders = FILES.filter((f) => /sdc-gray-500/.test(code(f))).map((f) => f.replace(SRC, "src"));
  assert.deepEqual(offenders, [], "use text-sdc-muted — sdc-gray-500 is not a declared token");
});

// ── The mockup's palette stays in the mockup (§39.16, §47) ──────────────────

test("no drill copies the reference's hex values", () => {
  // The reference is drawn in a warm-gray scheme. Copying it into a component is the
  // "duplicate theme definitions" §39.16 forbids — how the charts came to use a different
  // font from the rest of the app. Its structure was adopted; its colours were mapped.
  const mockupHexes = [
    "#f4f4f2", "#e2e0d9", "#eeece5", "#f3f2ec", "#16233a", "#2b5f8e",
    "#8b8b82", "#9a998f", "#a9a89f", "#6b6b64", "#22221c", "#fcfcfa", "#fbfbf9", "#f4f3ee",
  ];
  const offenders: string[] = [];
  for (const f of [...DRILLS, join(SRC, "components", "ui", "Drill.tsx")]) {
    const body = code(f).toLowerCase();
    for (const hex of mockupHexes) if (body.includes(hex)) offenders.push(`${f.replace(SRC, "src")}: ${hex}`);
  }
  assert.deepEqual(offenders, [], "map the reference onto the brand tokens rather than pasting its palette");
});

// ── One design, not three (§47) ─────────────────────────────────────────────

test("every drill routes its table through the shared components", () => {
  for (const f of DRILLS.slice(0, 2)) {
    const body = code(f);
    assert.match(body, /from "@\/components\/ui\/Drill"/, `${f.replace(SRC, "src")} must use the shared drill design`);
  }
});

test("no drill re-introduces a navy header band or zebra striping", () => {
  // The two treatments the redesign removed, and the two most likely to be pasted back in
  // from one of the big spreadsheet grids — where they belong and here they do not.
  const offenders: string[] = [];
  for (const f of DRILLS) {
    const body = code(f);
    if (/thead[^>]*bg-sdc-navy/.test(body)) offenders.push(`${f.replace(SRC, "src")}: navy header band`);
    if (/i % 2 === 1 \? "bg-sdc-gray-50/.test(body)) offenders.push(`${f.replace(SRC, "src")}: zebra stripes`);
    if (/border-t-2 border-sdc-navy/.test(body)) offenders.push(`${f.replace(SRC, "src")}: heavy navy total rule`);
  }
  assert.deepEqual(offenders, [], "drills read as reports: hairlines and type, not bands and stripes");
});

test("the drills do not use the spreadsheet grid tokens", () => {
  // TABLE_GRID and GRID_SCROLLER give every cell a border and sharp corners, which is
  // right for Monthly ETC and Projects (§41.23) and wrong for a rollup that is read
  // rather than edited. HoursDetailPanel used TABLE_GRID before the redesign.
  const offenders: string[] = [];
  for (const f of DRILLS) {
    const body = code(f);
    for (const token of ["TABLE_GRID", "GRID_SCROLLER"]) {
      if (body.includes(token)) offenders.push(`${f.replace(SRC, "src")}: ${token}`);
    }
  }
  assert.deepEqual(offenders, [], "grids read as spreadsheets, drills read as reports");
});

test("the header, the group rows and the total share one column template", () => {
  // The failure this prevents is specific: a hand-counted colSpan under a table whose
  // column count is `groupBy.length + 1`. Get it wrong and nothing errors — the total
  // simply lands in the wrong column. One `template()` used by all three rows cannot.
  assert.match(DRILL, /function template\(dimensions: number\)/);
  // DrillTable computes it ONCE and hands the same value to its header row and its total
  // row; DrillGroup derives its own from the same function. So there are three
  // references, not four, and no row states its own widths.
  assert.match(DRILL, /const cols = template\(columns\.length\)/, "DrillTable must compute it once");
  const gridTemplateUses = DRILL.match(/gridTemplateColumns: cols/g) ?? [];
  assert.equal(gridTemplateUses.length, 2, "the header row and the total row must both read that one value");
  assert.match(DRILL, /gridTemplateColumns: template\(columns\)/, "a group row derives its own from the same function");
});

test("the caret rotates rather than swapping glyph", () => {
  // UndefinedHoursPanel swapped ▶ for ▼, which jumps; HoursDetailPanel rotated. One
  // control, and it is the rotation — a glyph swap reads as two different marks.
  assert.match(DRILL, /rotate-90/);
  assert.doesNotMatch(code(join(SRC, "components", "UndefinedHoursPanel.tsx")), /open \? "▼" : "▶"/);
});

test("group rows are real buttons that report their state", () => {
  assert.match(DRILL, /aria-expanded=\{open\}/, "the disclosure must announce itself");
  assert.match(DRILL, /aria-pressed=\{on\}/, "the group options are toggles, not links");
});

// ── The footer the reference asks for (§47) ─────────────────────────────────

// ── The card keeps its own height; the drill scrolls (§49) ──────────────────
//
// The layout this replaces used flex's default `stretch` plus `[&>*]:h-full`, which made
// the KPI summary card and the drill panel equal height. That reads as a reasonable
// instruction ("line them up top and bottom") and has one loser: stretch gives a card the
// ROW's height without giving it any more content, so five KPI rows sat above ~200px of
// empty grey whenever a drill was open beside them.
//
// The replacement has two halves, and each half is useless without the other — which is
// why they are guarded together. Independent heights without a ceiling means a
// forty-five-row table sets the row's height and pushes the grid off the screen; a
// ceiling without independent heights means the ceiling never binds, because h-full
// overrides it with the row's height.

const KPI_CARDS = code(join(SRC, "components", "EtcMonthKpiCards.tsx"));

test("the summary card and the drill do not stretch to match each other", () => {
  assert.match(KPI_CARDS, /flex flex-wrap items-start gap-3/, "the row must align at the top, not stretch");
  // The specific mechanism that defeated the ceiling. `h-full` on the drill column's
  // child resolved to the row height, so `max-height` had nothing left to cap.
  assert.doesNotMatch(KPI_CARDS, /\[&>\*\]:h-full/, "nothing may force the drill panel to the row's height");
});

test("side by side is decided by wrapping, not by a viewport breakpoint", () => {
  // §26.2's lesson, which cost a whole round of "the parallel row is not working": this
  // row is inset by a sidebar that is ~276px expanded, so `xl` (1280px viewport) fires on
  // a box that is ~1000px wide. A flex-basis measures the box itself.
  assert.match(KPI_CARDS, /basis-\[28rem\]/, "the drill column needs a basis for the wrap decision");
  const breakpointed = /(?:sm|md|lg|xl|2xl):(?:flex-row|flex-col|items-start|items-stretch)/.exec(KPI_CARDS);
  assert.equal(breakpointed, null, `viewport breakpoints measure the wrong box here — found ${breakpointed?.[0]}`);
});

test("the drill's height ceiling is bounded at both ends", () => {
  const rule = /\.drill-cap\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(rule, ".drill-cap must be declared in globals.css");
  const body = rule[1].replace(/\s+/g, "");
  // Window-relative, so a short laptop never gets a panel taller than its viewport.
  assert.match(body, /100vh/, "the ceiling must respect the window");
  // Floored AND capped, which is the whole reason it is a clamp:
  //
  //   floor — zoom shrinks the viewport in CSS pixels while leaving rem where it is, so at
  //     400% the window bound goes negative and max-height clamps to ZERO. The drill would
  //     disappear at high zoom and nowhere else.
  //   cap   — measured live: with the window bound alone the parts drill took 770px on a
  //     950px viewport and pushed the grid 516px off the screen, which is the §26 problem
  //     reappearing inside its own fix.
  assert.match(body, /^max-height:clamp\(/, "clamp states the floor, the window bound and the cap at once");
  const [floor, , cap] = body.replace(/^max-height:clamp\(|\);?$/g, "").split(",");
  assert.ok(parseFloat(floor) > 0, `the floor must be positive, got ${floor}`);
  assert.ok(parseFloat(cap) > parseFloat(floor), `the cap must exceed the floor, got ${cap} vs ${floor}`);
});

test("every drill card carries the ceiling and exactly one scrolling region", () => {
  // Four drill cards: the shared panel (hours), the undefined-hours panel, and the two
  // hand-rolled ones on the Monthly ETC strip (parts, off-grid). All four read the same
  // two classes, so "how tall may a drill be" is one decision rather than four.
  const sites: [string, string, number][] = [
    ["src/components/ui/Drill.tsx", DRILL, 1],
    ["src/components/UndefinedHoursPanel.tsx", code(join(SRC, "components", "UndefinedHoursPanel.tsx")), 1],
    ["src/components/EtcMonthKpiCards.tsx", KPI_CARDS, 2],
  ];
  for (const [name, body, bodies] of sites) {
    assert.match(body, /DRILL_CAP/, `${name} must cap its drill card`);
    // Counted, not just present: a card with two scrolling regions has two scrollbars and
    // the shorter one wins, which is how the Lines view came to show less than the rollup
    // it toggles with. The declaration and the import are references to the name rather
    // than uses of it, so they come off the count.
    const declared = /export const DRILL_BODY/.test(body) ? 1 : 0;
    // No `s` flag needed, and it is not available at this target: a negated class matches
    // newlines whether or not `.` does.
    const imported = /import \{[^}]*DRILL_BODY/.test(body) ? 1 : 0;
    const used = (body.match(/DRILL_BODY/g) ?? []).length - declared - imported;
    assert.equal(used, bodies, `${name}: expected ${bodies} scrolling ${bodies === 1 ? "region" : "regions"}, found ${used}`);
  }
});

test("the scrolling body is basis-auto, never flex-1", () => {
  // `flex-1` sets `flex-basis: 0`, which makes an auto-height flex column compute its
  // height from a zero-height body — the card collapses to its header instead of growing
  // to its content and then capping. The bug looks like "the drill is empty".
  assert.match(DRILL, /export const DRILL_BODY = "[^"]*basis-auto/);
  assert.doesNotMatch(DRILL, /export const DRILL_BODY = "[^"]*flex-1/);
  // And min-h-0, or the item refuses to go below its own content height and the card
  // overflows its ceiling instead of scrolling.
  assert.match(DRILL, /export const DRILL_BODY = "[^"]*min-h-0/);
});

test("the total stays on screen while the rollup scrolls", () => {
  // Before the card had a ceiling this row was simply the last thing in a content-height
  // panel, so it was always visible. Once the body scrolls, a fifty-group rollup pushes the
  // figure the drill exists to reconcile out of sight unless it is pinned.
  const total = /role="row"\s*\n?\s*className="([^"]*)"/.exec(
    DRILL.slice(DRILL.indexOf("The total, on the same template")),
  );
  assert.ok(total, "the total row must carry a class list");
  assert.match(total[1], /sticky bottom-0/, "pin the total to the bottom of the scroller");
  // Opaque, or the rows travelling underneath read through it.
  assert.match(total[1], /bg-sdc-gray-50/);
});

test("no drill nests a second fixed-height scroller inside its scrolling body", () => {
  // The two that did: HoursDetailPanel's flat punch list (24rem) and UndefinedHoursPanel's
  // (20rem). Both predate the ceiling, and both capped the ungrouped view shorter than the
  // rollup beside it once the panel itself started scrolling.
  //
  // DrillGroup's own 18rem scroller is deliberately NOT covered here: it bounds the lines
  // inside ONE expanded group so the total row stays reachable, which is a different job.
  for (const f of ["HoursDetailPanel.tsx", "UndefinedHoursPanel.tsx"]) {
    const body = code(join(SRC, "components", f));
    const offenders = body.match(/max-h-(?:80|\[24rem\])[^"`]*overflow-auto/g) ?? [];
    assert.deepEqual(offenders, [], `${f}: the panel body is the scroller — a nested cap fights it`);
  }
});

test("the hours drill can export what is on screen", () => {
  // The reference puts "Export CSV" in the footer. It exports the FILTERED rows — the
  // point of exporting from a drill rather than from the page — and always the punch
  // lines, never the rollup, because a CSV of "Mechanical Engineering, 56" is not
  // something anyone can work with.
  const hdp = code(join(SRC, "components", "HoursDetailPanel.tsx"));
  assert.match(hdp, /function exportCsv/);
  assert.match(hdp, /rows\.map\(/, "it must serialise the filtered rows");
  assert.match(hdp, /csvRow/, "…through the shared CSV writer, not a hand-rolled join");
  assert.match(hdp, /<DrillAction onClick=\{exportCsv\}/);
});
