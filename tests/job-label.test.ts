import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeJobLabel, resolveJobLabel, buildJobLabelIndex } from "../src/lib/job-label";

// The rule that matters most: "2026 SERVICE" and "2026 Spare Parts" are separate
// Paylocity categories sharing a leading 2026, and job number 2026 IS
// "2026 Spare Parts". Nothing here may key on the numeric prefix.
const JOBS = [
  { jobId: "10001", jobName: "2025 Service" },
  { jobId: "2026", jobName: "2026 Spare Parts" },
  { jobId: "2025", jobName: "2025 Spare Parts" },
  { jobId: "10000", jobName: "StateLogic Diagrams" },
];

test("the label formats actually in the files all normalize to the same key", () => {
  assert.equal(normalizeJobLabel("2025 SERVICE"), "2025 service");
  assert.equal(normalizeJobLabel("2025 Service"), "2025 service");
  assert.equal(normalizeJobLabel("2023_SER"), "2023 service");
  assert.equal(normalizeJobLabel("2024_SER"), "2024 service");
  assert.equal(normalizeJobLabel("2026 SERVICE"), "2026 service");
  assert.equal(normalizeJobLabel("2025-Service"), "2025 service");
  assert.equal(normalizeJobLabel("  2025   service  "), "2025 service");
});

test("Service never collides with Spare Parts for the same year", () => {
  assert.notEqual(normalizeJobLabel("2026 SERVICE"), normalizeJobLabel("2026 Spare Parts"));
  const idx = buildJobLabelIndex(JOBS);
  // The critical assertion: a 2026 Service punch must NOT land on job 2026.
  assert.equal(resolveJobLabel("2026 SERVICE", idx), null, "no 2026 Service job exists yet, so it must stay unresolved");
  assert.equal(resolveJobLabel("2026 Spare Parts", idx), "2026");
});

test("2025 Service resolves to its existing job, which is NOT job 2025", () => {
  const idx = buildJobLabelIndex(JOBS);
  assert.equal(resolveJobLabel("2025 SERVICE", idx), "10001");
  assert.notEqual(resolveJobLabel("2025 SERVICE", idx), "2025", "job 2025 is Spare Parts, not Service");
  assert.equal(resolveJobLabel("2023_SER", idx), null, "no 2023 Service job exists");
});

test("creating the job is all it takes — no code change", () => {
  // The "future Service punches flow automatically" requirement, as a test.
  const withNewJob = buildJobLabelIndex([...JOBS, { jobId: "10002", jobName: "2026 Service" }]);
  assert.equal(resolveJobLabel("2026 SERVICE", withNewJob), "10002");
  assert.equal(resolveJobLabel("2026 Spare Parts", withNewJob), "2026", "and Spare Parts is unaffected");
});

test("'Not Defined' never resolves, even if a job were named that", () => {
  // 16,659h of it. Attributing uncoded punches to a job would be inventing data.
  const idx = buildJobLabelIndex([...JOBS, { jobId: "9999", jobName: "Not Defined" }]);
  assert.equal(resolveJobLabel("Not Defined", idx), null);
  assert.equal(resolveJobLabel("NOT DEFINED", idx), null);
  assert.equal(idx.has("not defined"), false, "it is kept out of the index entirely");
});

test("SER is expanded only as a whole word", () => {
  // A job legitimately containing "ser" inside a word must not become "service".
  assert.equal(normalizeJobLabel("Sermatech Coating"), "sermatech coating");
  assert.equal(normalizeJobLabel("2023_SER"), "2023 service");
});

test("a duplicated job name resolves to nothing rather than a coin flip", () => {
  const idx = buildJobLabelIndex([
    { jobId: "111", jobName: "2027 Service" },
    { jobId: "222", jobName: "2027 SERVICE" },
  ]);
  assert.equal(resolveJobLabel("2027 Service", idx), null, "ambiguous names stay unattributed and therefore visible");
});

test("empty and junk labels resolve to nothing", () => {
  const idx = buildJobLabelIndex(JOBS);
  for (const v of ["", "   ", "---", null, undefined]) assert.equal(resolveJobLabel(v as string, idx), null);
  assert.equal(normalizeJobLabel(""), "");
  assert.equal(normalizeJobLabel("---"), "");
});

test("a numeric-looking label is left to the numeric path", () => {
  // "1037-02" is a machine-suffixed job number, a separate problem — it must not
  // be name-matched onto job 1037.
  const idx = buildJobLabelIndex([...JOBS, { jobId: "1037", jobName: "Some Real Job" }]);
  assert.equal(resolveJobLabel("1037-02", idx), null);
});
