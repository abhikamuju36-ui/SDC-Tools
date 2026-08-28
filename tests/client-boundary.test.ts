import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// ── A React hook may not be called from a server component (2026-08-28) ─────
//
// This exists because it shipped and took the whole Dashboard down at request
// time:
//
//   ⨯ Error: Attempted to call useJobDrill() from the server but useJobDrill is
//     on the client. It's not possible to invoke a client function from the
//     server, it can only be rendered as a Component or passed to props of a
//     Client Component.
//
// A hook was added to DashboardOverview.tsx, which has no "use client".
//
// ── Why nothing else caught it ──────────────────────────────────────────────
//
// - `tsc` does not model the RSC boundary at all; the code type-checks.
// - `next build` PASSED. The Dashboard is a dynamic route (ƒ), so it is never
//   prerendered at build time and the boundary is only crossed on a real
//   request. A green build is not evidence here.
// - ESLint's react-hooks rules check hook ORDER, not which side of the boundary
//   the file is on.
//
// So the cheapest reliable check is this one: scan the component sources and
// require that any file calling a hook declares "use client". That is exactly
// the rule the runtime enforces, applied statically.

const COMPONENTS = join(process.cwd(), "src", "components");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Strips comments and string literals so a hook NAMED in prose is not read as a call. */
function stripNoise(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

// `use` itself (React 19's) is legal in a server component, as are the two
// Next.js server helpers that happen to match the use* shape.
const SERVER_SAFE = new Set(["use", "useId"]);

test("every component that calls a React hook is a client component", () => {
  const offenders: string[] = [];

  for (const file of walk(COMPONENTS)) {
    const raw = readFileSync(file, "utf8");
    const isClient = /^\s*(["'])use client\1/m.test(raw.slice(0, 200));
    if (isClient) continue;

    const code = stripNoise(raw);
    // A hook CALL: use<Uppercase>… immediately followed by "(". Excludes
    // imports (`import { useX }`), type positions, and prose.
    const called = new Set<string>();
    for (const m of code.matchAll(/\b(use[A-Z]\w*)\s*\(/g)) {
      if (!SERVER_SAFE.has(m[1])) called.add(m[1]);
    }
    // An import alone is fine — a server component may import a client
    // component's module. Only a CALL is the error.
    if (called.size > 0) {
      offenders.push(`${relative(process.cwd(), file)}: ${[...called].sort().join(", ")}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these files call a React hook but have no "use client" — they will throw at request time, not at build time:\n  ${offenders.join("\n  ")}`,
  );
});

test("the guard actually detects a hook call (it is not vacuously passing)", () => {
  // A scanner that silently matches nothing would pass this suite forever. Prove
  // the detection works on a known-bad sample before trusting the empty result.
  const sample = stripNoise(`
    import { useJobDrill } from "./x";
    export function Bad() {
      const drill = useJobDrill();
      return null;
    }
  `);
  const found = [...sample.matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map((m) => m[1]);
  assert.deepEqual(found, ["useJobDrill"]);
});

test("the guard ignores a hook named only in a comment or a string", () => {
  const sample = stripNoise(`
    // useJobDrill() is called by ActiveJobsSection, not here.
    /* useSomething() */
    const label = "useThing()";
    export function Fine() { return null; }
  `);
  const found = [...sample.matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map((m) => m[1]);
  assert.deepEqual(found, []);
});
