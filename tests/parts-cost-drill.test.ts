import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Parts Cost drill-through (2026-09-02) ───────────────────────────────────
//
// The requirement this exists to hold is "no mismatch is acceptable": every figure
// in the panel must tie to the bar above it. That property is achieved structurally
// — the panel re-sums `financials.lines`, the very rows getPartsCostFinancials
// derived the card's totals from — so what these guard is that the structure stays
// that way, rather than the arithmetic, which is a subtraction.
//
// Driven live on job 1131 before being written down, and the figures below are that
// job's real ones: Invoiced mode 504 lines summing to $200,863 (= the card's
// Invoiced exactly), Left to be invoiced 110 lines summing to $13,017 (= the card's
// figure exactly), Actual / Projection 645 lines summing to $213,881 (= the bar's
// own total exactly). Mode pills, search (504 lines · 14 shown), column sort, and
// Close all exercised in the running app.

const SRC = join(import.meta.dirname, "..", "src");
const strip = (raw: string) => raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DRILL = readFileSync(join(SRC, "components", "PartsCostDrill.tsx"), "utf8");
const DRILL_CODE = strip(DRILL);
const CARD = strip(readFileSync(join(SRC, "components", "PartsCostSummary.tsx"), "utf8"));
const DASH = strip(readFileSync(join(SRC, "components", "JobHoursDashboard.tsx"), "utf8"));
const FIN = strip(readFileSync(join(SRC, "lib", "parts-cost-financials.ts"), "utf8"));

test("the panel sums the same rows and the same fields the card's totals come from", () => {
  // This is the whole reconciliation guarantee. getPartsCostFinancials computes
  // Invoiced as Σ actualAmount and Left to be invoiced from Σ totalPrice; the panel
  // must read those two fields off the same `lines` array, not re-derive either from
  // a second source that can drift.
  assert.match(FIN, /const invoiced = actualTotal\(lines\)/);
  assert.match(DRILL_CODE, /financials\.lines\.map\(\(l\) => \(\{ \.\.\.l, leftToInvoice: l\.totalPrice - l\.actualAmount \}\)\)/);
  assert.match(DRILL_CODE, /invoiced \+= r\.actualAmount/);
  assert.match(DRILL_CODE, /purchased \+= r\.totalPrice/);
});

test("the money modes fetch nothing — only the ETC history touches the server", () => {
  // Invoiced and Left to be invoiced re-sum rows already on the client for the card
  // itself, so a fetch there would be both a wait nobody needs and a second chance
  // to return data that disagrees with the bar. The ETC history is the one thing not
  // already present (it lives in EtcEntry, not in the parts lines), so it is the one
  // fetch — made on open, not with the page.
  assert.ok(!/fetch\(/.test(DRILL_CODE), "no ad-hoc fetching");
  assert.equal((DRILL_CODE.match(/loadPartsEtcHistory\(/g) ?? []).length, 1, "exactly one server call");
  assert.match(DRILL_CODE, /if \(mode !== "etc"\) return;/, "and only when the ETC mode is open");
});

test("the ETC fetch cannot loop, and a late answer cannot land on a closed panel", () => {
  // `jobIds` is a fresh array every render, so depending on it directly would restart
  // the fetch forever; the joined key is what makes the effect stable.
  assert.match(DRILL_CODE, /const jobKey = jobIds\.join\(","\)/);
  assert.match(DRILL_CODE, /\}, \[mode, jobKey\]\)/);
  assert.match(DRILL_CODE, /if \(alive\) setHistory\(rows\)/);
});

test("a failed history and an empty history do not render as the same thing", () => {
  // undefined = not asked yet, null = asked and failed, [] = asked and there is
  // genuinely none. Collapsing the last two would report a broken query as "no data".
  assert.match(DRILL_CODE, /useState<PartsEtcMonth\[\] \| null \| undefined>\(undefined\)/);
  assert.match(DRILL_CODE, /history === null \? \(/);
  assert.match(DRILL, /Couldn&apos;t load the ETC history/);
});

test("the ETC history is the monthly drawdown, scoped to the same jobs as the card", () => {
  const action = readFileSync(join(SRC, "lib", "parts-etc-history-actions.ts"), "utf8");
  assert.match(action, /section: PARTS_COST_SECTION/, "parts ETC, not an hours section");
  assert.match(action, /orderBy: \{ month: "asc" \}/);
  assert.match(action, /row\.newEtc \+= effectiveNewEtc\(e\)/, "the same effective-value rule the grid renders with");
  // Called per entry then summed: a submitted job and an untouched one in the same
  // month resolve differently, so a merged pseudo-entry would get both wrong.
  assert.ok(!/effectiveNewEtc\(row\)/.test(action));
  assert.match(DASH, /jobIds=\{data\.jobRefs\.map\(\(j\) => j\.id\)\}/);
});

test("a month is only shown as settled when every job in it is", () => {
  const action = readFileSync(join(SRC, "lib", "parts-etc-history-actions.ts"), "utf8");
  assert.match(action, /row\.needsReview = row\.needsReview \|\| e\.needsReview/);
  assert.match(DRILL_CODE, /h\.needsReview \? \(/);
});

test("row-level money carries cents, so the rows visibly add up to the footer", () => {
  // Whole dollars made 504 rows appear to miss their own footer by ~$13. The footer
  // was right and the rows were rounded, but a reader cannot know that — and
  // largest-remainder redistribution (the card's trick) would fix the column total
  // by printing individual rows a dollar off their real value, which is exactly
  // wrong for lines someone may check against an invoice.
  assert.match(DRILL_CODE, /const money = usd2;/);
  assert.match(DRILL_CODE, /money\(r\.actualAmount\)/);
  assert.match(DRILL_CODE, /money\(sums\.invoiced\)/, "the footer must use the same precision as the column");
});

test("totals are summed over the mode's rows, not over the search results", () => {
  // A total that shrank as someone typed in the search box would be a different
  // number wearing the same label — and would stop matching the bar, which is the
  // one thing this panel exists to do.
  assert.match(DRILL_CODE, /for \(const r of scoped\)/);
  assert.ok(!/for \(const r of (sorted|searched)\)/.test(DRILL_CODE));
});

test("each mode scopes to the rows that actually contribute to its figure", () => {
  assert.match(DRILL_CODE, /if \(mode === "invoiced"\) return rows\.filter\(\(r\) => r\.actualAmount !== 0\)/);
  assert.match(DRILL_CODE, /if \(mode === "left"\) return rows\.filter\(\(r\) => r\.leftToInvoice !== 0\)/);
});

test("the bar's second segment is reported as the residual, not just as ETC", () => {
  // Measured on 1131: the card labels that segment "ETC" but DRAWS projection −
  // invoiced, which is the larger of ETC and Left to be invoiced. Those differ by an
  // order of magnitude there ($2,000 vs $13,017), so a panel showing only the raw ETC
  // would print $2,000 beside a bar visibly drawn at $13,017 and read as a mismatch.
  assert.match(DRILL_CODE, /label: "Residual on the bar"/);
  assert.match(DRILL_CODE, /usd\(financials\.projection - financials\.invoiced\)/);
  assert.match(DRILL_CODE, /label: "ETC"/, "the raw ETC is still stated alongside it");
});

test("the job-wide zero floor on Left to be invoiced is surfaced, not reconciled away", () => {
  // `leftToInvoice` is floored at 0 across the job, so on a job whose posted spend
  // exceeds its purchased total the rows sum negative while the card shows 0. Saying
  // so beats printing two numbers and letting the reader find the gap.
  // On a TOLERANCE, not `!==`. The exact comparison fired on job 1101, where both
  // sides are $61,126.04 and differ only in the last bits of a float accumulated
  // over 2,132 rows — printing "these rows sum to $61,126; the card shows $61,126
  // because that figure is floored at zero", a sentence that contradicts itself and
  // costs the panel exactly the credibility it exists to have.
  assert.match(DRILL_CODE, /Math\.abs\(financials\.leftToInvoice - sums\.left\) > 0\.005/);
  assert.ok(!/financials\.leftToInvoice !== sums\.left/.test(DRILL_CODE), "exact float equality must not return");
  assert.match(DRILL_CODE, /floored\s*\n?\s*\?/, "the note must be driven by that flag");
});

test("ETC claims no part-level breakdown, because none exists", () => {
  // financials.etc is one monthly figure from the Monthly ETC grid, not built from
  // part rows. Apportioning it across parts would produce rows that sum correctly and
  // mean nothing.
  const etcView = DRILL.slice(DRILL.indexOf('mode === "etc" ?'));
  assert.match(etcView, /not built up from part rows/);
  assert.match(etcView, /Monthly ETC/);
  assert.ok(!/etc.*rows\.filter/.test(DRILL_CODE), "there must be no synthesized ETC row set");
});

test("every segment and the whole bar are real buttons with their own names", () => {
  // Per-element buttons rather than one handler hit-testing by offsetY: the browser's
  // hit-testing is exact, and each target gets a name, focus and Enter/Space free.
  assert.match(CARD, /onClick=\{\(\) => onDrill\(s\.key === "etc" \? "etc" : "invoiced"\)\}/);
  assert.match(CARD, /onClick=\{\(\) => onDrill\("projection"\)\}/, "the caption opens the whole-bar view");
  assert.match(CARD, /onClick=\{\(\) => onDrill\("left"\)\}/, "the legend chip opens its own rows");
  assert.match(CARD, /aria-label=\{`\$\{s\.label\} \$\{usd\(s\.value\)\}/);
});

test("the card still renders without a drill host", () => {
  // `onDrill` is optional so the card stays usable anywhere with nowhere to put a
  // panel — and the non-interactive branch must remain a plain div, not a button
  // that does nothing.
  assert.match(CARD, /onDrill\?: \(mode: PartsDrillMode\) => void;/);
  assert.match(CARD, /onDrill \? \(/);
});

test("the panel renders full width below the row, in the selected job's context", () => {
  // Inside the ~15% column the card occupies, an eleven-column table is unreadable;
  // and rendering it as a sibling of the grid row means opening it cannot resize
  // either chart above it.
  assert.match(DASH, /\{parts && partsDrill && \(/);
  assert.match(DASH, /jobLabel=\{/);
  assert.match(DASH, /\$\{data\.job\.jobId\} — \$\{data\.job\.jobName\}/, "one job: name the job");
  assert.match(DASH, /`\$\{parts\.jobCount\} selected jobs`/, "many jobs: say so rather than naming one");
});

test("the parts drill and the section-hours drill are independent", () => {
  // Different questions about the same job; opening one must not close the other.
  assert.match(DASH, /const \[partsDrill, setPartsDrill\] = useState<PartsDrillMode \| null>\(null\)/);
  assert.match(DASH, /const \[drillCode, setDrillCode\] = useState<string \| null>\(null\)/);
});

test("the panel closes back to the same page, and titles say which mode is open", () => {
  assert.match(DASH, /onClose=\{\(\) => setPartsDrill\(null\)\}/);
  assert.match(DRILL_CODE, /projection: "Parts Cost Detail — Actual \/ Projection"/);
  assert.match(DRILL_CODE, /invoiced: "Parts Cost Detail — Invoiced"/);
  assert.match(DRILL_CODE, /etc: "Parts Cost Detail — ETC"/);
});

test("nothing here opens a separate report or tab", () => {
  // §62 removed "Open full report" from every drill in this app; this one must not
  // reintroduce the pattern.
  assert.ok(!/target="_blank"|window\.open|Open full report/.test(DRILL_CODE));
});
