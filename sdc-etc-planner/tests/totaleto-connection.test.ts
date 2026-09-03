import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { classifyTotalEto, describeTotalEtoFailure, TOTALETO_TIMEOUT, totalEtoConfig } from "../src/lib/totaleto-connection";
import { TOTALETO_SOURCES } from "../src/lib/auto-sync";

// ── One Total ETO connection, one diagnosis (2026-09-01) ────────────────────
//
// Four refresh sources failed at once — Parts cost, Parts cost actual, Jobs from
// TotalETO, Cash Flow snapshot — and establishing that they shared a cause took
// an investigation, because the identical connection config existed in FOUR
// files. It is one module now; these tests keep it that way and pin the
// classification that turns a driver message into something actionable.

const LIB = join(process.cwd(), "src", "lib");

test("a rejected login is distinguished from an unreachable server", () => {
  // The operational difference: a rejected login needs a person to change a
  // credential and retrying cannot help. Everything else is worth retrying.
  // Reporting them the same way is what made a two-hour credential outage look
  // like a flaky feed.
  assert.equal(classifyTotalEto(Object.assign(new Error("Login failed for user 'x'."), { code: "ELOGIN" })), "login_rejected");
  // The real message from 2026-09-01, which carries no 'Login failed for user' text.
  assert.equal(
    classifyTotalEto(
      Object.assign(new Error("Login failed. The login is from an untrusted domain and cannot be used with Integrated authentication."), {
        code: "ELOGIN",
      }),
    ),
    "login_rejected",
  );
  assert.equal(classifyTotalEto(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })), "unreachable");
  assert.equal(classifyTotalEto(Object.assign(new Error("getaddrinfo ENOTFOUND host"), { code: "ENOTFOUND" })), "unreachable");
  assert.equal(classifyTotalEto(Object.assign(new Error("Timeout: Request failed"), { code: "ETIMEOUT" })), "timeout");
});

test("a bug in OUR query is NOT excused as an infrastructure blip", () => {
  // The dangerous failure mode of a classifier like this: a real defect wearing
  // "probably the network" and never getting looked at.
  assert.equal(classifyTotalEto(new Error("Invalid column name 'Foo'.")), "other");
  assert.equal(classifyTotalEto(new Error("Conversion failed when converting date")), "other");
  assert.match(describeTotalEtoFailure(new Error("Invalid column name 'Foo'.")), /Total ETO query failed/);
});

test("the login-rejected message says who must do what", () => {
  const msg = describeTotalEtoFailure(Object.assign(new Error("Login failed."), { code: "ELOGIN" }));
  assert.match(msg, /TOTALETO_DB_USER/, "must name the setting to change");
  assert.match(msg, /Retrying will not help/, "must say the hourly schedule cannot fix this");
  assert.match(msg, /SERVER-APP1/, "must name the server");
});

test("a retryable failure says so, and does not send anyone to .env", () => {
  const msg = describeTotalEtoFailure(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
  assert.match(msg, /Worth retrying/);
  assert.ok(!/TOTALETO_DB_PASSWORD/.test(msg), "a network blip is not a credentials problem");
});

test("there is exactly ONE Total ETO connection config in the app", () => {
  // The four copies (sync-totaleto, cash-flow-totaleto, cash-flow-drill, job-bom)
  // are what made "one shared failure or four separate ones?" unanswerable from
  // the source. A fifth copy would bring that back.
  const offenders: string[] = [];
  for (const file of readdirSync(LIB).filter((f) => f.endsWith(".ts"))) {
    if (file === "totaleto-connection.ts") continue;
    const s = readFileSync(join(LIB, file), "utf8");
    if (s.includes("SERVER-APP1")) offenders.push(`${file} hardcodes the Total ETO server`);
    if (/domain:\s*"stevendouglas"/.test(s)) offenders.push(`${file} builds its own NTLM config`);
  }
  assert.deepEqual(offenders, [], offenders.join("\n  "));
});

test("per-caller query timeouts survived the consolidation", () => {
  // These differences are real — a BOM walk legitimately needs longer than a job
  // list — so flattening them to one value would have been a regression dressed
  // as cleanup.
  assert.ok(TOTALETO_TIMEOUT.bom > TOTALETO_TIMEOUT.cashFlow);
  assert.ok(TOTALETO_TIMEOUT.cashFlow > TOTALETO_TIMEOUT.sync);
  assert.equal(totalEtoConfig(TOTALETO_TIMEOUT.bom).requestTimeout, TOTALETO_TIMEOUT.bom);
});

test("the config still authenticates over NTLM against the right database", () => {
  const c = totalEtoConfig();
  assert.equal(c.database, "SDC");
  assert.equal(c.domain, "stevendouglas", "NTLM, not a SQL login — this is why a domain password change breaks it");
  assert.equal(c.port, 1433);
});

test("the four Total ETO refresh sources are named in one place", () => {
  // The lane checks the login once for exactly this set; if a fifth Total ETO
  // source is added and not listed, it would get a raw driver message again.
  assert.deepEqual(
    [...TOTALETO_SOURCES].sort(),
    ["cash_flow_snapshot", "parts_cost", "parts_cost_actual", "totaleto_jobs"],
  );
});

test("a rejected login short-circuits the lane; a blip does not", () => {
  // Only login_rejected skips the four queries. A transient preflight failure
  // must not cost a pass that would otherwise have succeeded.
  const s = readFileSync(join(LIB, "auto-sync.ts"), "utf8");
  assert.match(s, /login\.kind === "login_rejected"/, "only a rejected login blocks the lane");
  assert.equal((s.match(/if \(blocked\) throw new Error\(blocked\);/g) ?? []).length, 4, "all four sources honour it");
});
