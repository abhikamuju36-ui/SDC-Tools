import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readinessLine,
  submitButtonLabel,
  confirmTitle,
  confirmBody,
  standardFeesSubmitBlurb,
  canOpenConfirm,
  isSubmitButtonDisabled,
  canConfirmSubmit,
  canDismissDialog,
  isMonthDataStale,
  didMonthChange,
  staleDialogMessage,
  failureExplanation,
  receiptLines,
  receiptHeadline,
  type MonthlyReportValidation,
  type SubmitContext,
  type SubmitPhase,
} from "../src/lib/monthly-report-flow";

// `Submit {Month} Report` (§26) — the one irreversible action in the app, now a
// seven-state workflow behind a confirmation dialog.
//
// These cover the rules, not the pixels: which month the label names, when the
// button may be pressed, when the dialog may be dismissed, what a stale
// confirmation does, and that a failure says which KIND of failure it was.

const READY: MonthlyReportValidation = {
  ok: true,
  issues: [],
  totalIssues: 0,
  sections: ["Monthly ETC", "Standard Sheet", "Standard Card"],
  counts: { entries: 438, jobs: 61, missingNewEtc: 0, standardJobs: 42 },
};

const MISSING_NEW_ETC: MonthlyReportValidation = {
  ok: false,
  issues: [
    { section: "Monthly ETC", rowRef: "1105 — Line 3 Retrofit", department: "Mechanical", column: "New ETC", reason: "No New ETC entered." },
  ],
  totalIssues: 12,
  sections: ["Monthly ETC", "Standard Sheet", "Standard Card"],
  counts: { entries: 438, jobs: 61, missingNewEtc: 12, standardJobs: 42 },
};

const POOLS_STALE: MonthlyReportValidation = {
  ok: false,
  issues: [{ section: "Standard Card", rowRef: "2026-07", column: "Department pools", reason: "The pools on screen are 2026-06's." }],
  totalIssues: 1,
  sections: ["Monthly ETC", "Standard Sheet", "Standard Card"],
  counts: { entries: 438, jobs: 61, missingNewEtc: 0, standardJobs: 42 },
};

function ctx(over: Partial<SubmitContext> = {}): SubmitContext {
  return {
    phase: "ready",
    monthName: "July",
    permitted: true,
    validation: READY,
    pendingSaves: false,
    ...over,
  };
}

// ── The label follows the month picker (§26.1) ──────────────────────────────

test("the label names the selected month, and changes with it", () => {
  assert.equal(submitButtonLabel(ctx({ monthName: "July" })), "Submit July Report");
  assert.equal(submitButtonLabel(ctx({ monthName: "August" })), "Submit August Report");
  assert.equal(submitButtonLabel(ctx({ monthName: "September" })), "Submit September Report");
});

test("every in-flight and finished label names the month too", () => {
  const labels: Record<string, string> = {};
  for (const phase of ["validating", "submitting", "submitted", "failed"] as SubmitPhase[]) {
    labels[phase] = submitButtonLabel(ctx({ phase, monthName: "August" }));
  }
  assert.equal(labels.validating, "Validating August report…");
  assert.equal(labels.submitting, "Submitting August report…");
  // §26.8: the button says so afterwards rather than sitting there inviting a
  // second submission.
  assert.equal(labels.submitted, "August Report Submitted");
  // §26.9: a retry is offered, and it is worded as a retry.
  assert.equal(labels.failed, "Retry August Report");
  for (const [, text] of Object.entries(labels)) assert.ok(text.includes("August"), text);
});

test("the dialog and the blurb name the selected month", () => {
  assert.equal(confirmTitle("September"), "Submit September Report?");
  assert.ok(confirmBody("September").includes("complete September report"));
  // §26.5: it must list what is being finalized, not just say "are you sure".
  for (const part of ["Monthly ETC", "Standard Sheet", "Standard Card", "Standard Fees", "hours", "parts-cost"]) {
    assert.ok(confirmBody("September").includes(part), `confirm body should mention ${part}`);
  }
  // §26.12: the instructional text must point at the button below it, not at a
  // toolbar the button no longer lives in.
  const blurb = standardFeesSubmitBlurb("September");
  assert.ok(blurb.includes("September"));
  assert.ok(blurb.includes("button below"));
  assert.ok(!/toolbar/i.test(blurb));
});

// ── Readiness (§26.4) ───────────────────────────────────────────────────────

test("a ready month says so, with what it is about to freeze", () => {
  const line = readinessLine(ctx());
  assert.equal(line.tone, "ok");
  assert.equal(line.text, "Ready to submit");
  assert.match(line.detail ?? "", /438 ETC entries across 61 jobs/);
});

test("missing New ETC values lead the message and are counted", () => {
  const line = readinessLine(ctx({ phase: "blocked", validation: MISSING_NEW_ETC }));
  assert.equal(line.tone, "blocked");
  assert.equal(line.text, "Submission blocked: 12 required New ETC values are missing");
});

test("other outstanding items are named alongside the New ETC count", () => {
  // A manager who clears every yellow cell and finds the button still refused,
  // with no explanation, is exactly the dead end §26.4 exists to prevent.
  const mixed = { ...MISSING_NEW_ETC, totalIssues: 13 };
  const line = readinessLine(ctx({ phase: "blocked", validation: mixed }));
  assert.ok(line.detail?.includes("1 other item"), line.detail);
});

test("issues that are not New ETC report as a plain count", () => {
  const line = readinessLine(ctx({ phase: "blocked", validation: POOLS_STALE }));
  assert.equal(line.text, "1 item still requires attention");
});

test("readiness is not guessed before the server has answered", () => {
  const line = readinessLine(ctx({ phase: "checking", validation: null }));
  assert.equal(line.tone, "neutral");
  assert.match(line.text, /Checking whether July is ready/);
});

test("an unauthorized user is told so, whatever the data says", () => {
  const line = readinessLine(ctx({ permitted: false, validation: READY }));
  assert.equal(line.tone, "blocked");
  assert.match(line.text, /permission/i);
});

// ── Which clicks are allowed (§26.7, §26.16 #6/#17) ─────────────────────────

test("an incomplete month cannot open the confirmation dialog at all", () => {
  assert.equal(canOpenConfirm(ctx({ phase: "blocked", validation: MISSING_NEW_ETC })), false);
  assert.equal(isSubmitButtonDisabled(ctx({ phase: "blocked", validation: MISSING_NEW_ETC })), true);
});

test("the dialog cannot be opened before readiness is known", () => {
  assert.equal(canOpenConfirm(ctx({ phase: "checking", validation: null })), false);
});

test("a ready month can open it; a failed attempt can reopen it", () => {
  assert.equal(canOpenConfirm(ctx({ phase: "ready" })), true);
  assert.equal(canOpenConfirm(ctx({ phase: "failed" })), true);
});

test("nothing can be opened without permission, even with clean data", () => {
  assert.equal(canOpenConfirm(ctx({ permitted: false })), false);
  assert.equal(canConfirmSubmit(ctx({ phase: "confirming", permitted: false })), false);
});

test("duplicate clicks cannot start a second submission", () => {
  // The one property that matters: once the workflow has left `confirming`,
  // neither button will act again. A second click lands on a disabled control
  // rather than racing the first.
  for (const phase of ["confirming", "validating", "submitting", "submitted"] as SubmitPhase[]) {
    assert.equal(canOpenConfirm(ctx({ phase })), false, `outer button should be inert while ${phase}`);
  }
  assert.equal(canConfirmSubmit(ctx({ phase: "confirming" })), true);
  for (const phase of ["validating", "submitting", "submitted", "failed"] as SubmitPhase[]) {
    assert.equal(canConfirmSubmit(ctx({ phase })), false, `confirm button should be inert while ${phase}`);
  }
});

test("the dialog cannot be dismissed out from under a running submission", () => {
  // Escape, the backdrop and Cancel all ask this. Closing mid-transaction would
  // hide an outcome the user has no other way to see.
  assert.equal(canDismissDialog("confirming"), true);
  assert.equal(canDismissDialog("failed"), true);
  assert.equal(canDismissDialog("submitted"), true);
  assert.equal(canDismissDialog("validating"), false);
  assert.equal(canDismissDialog("submitting"), false);
});

// ── Stale confirmations (§26.6, §26.16 #16) ─────────────────────────────────

test("a fingerprint that moved while the dialog was open is stale", () => {
  assert.equal(isMonthDataStale("abc", "abc"), false);
  assert.equal(isMonthDataStale("abc", "def"), true);
});

test("an unknown fingerprint counts as stale, not as agreement", () => {
  // Opening the dialog without a known-good reading, or a server that could not
  // produce one, must cost a click — not silently submit whatever is there.
  assert.equal(isMonthDataStale(null, "abc"), true);
  assert.equal(isMonthDataStale("abc", null), true);
  assert.equal(isMonthDataStale(null, null), true);
});

test("switching month while the dialog is open stops the submission", () => {
  assert.equal(didMonthChange("2026-07", "2026-07"), false);
  assert.equal(didMonthChange("2026-07", "2026-08"), true);
  const msg = staleDialogMessage("July", "month");
  assert.match(msg, /nothing was submitted/i);
  assert.match(msg, /submit again/i);
});

test("a stale-data message says who moved it and that nothing was frozen", () => {
  const msg = staleDialogMessage("July", "data");
  assert.match(msg, /July/);
  assert.match(msg, /somebody else saved/i);
  assert.match(msg, /Nothing was submitted/i);
});

// ── Failure, by category (§26.9) ────────────────────────────────────────────

test("each failure names its category and whether retrying is safe", () => {
  const cases: [Parameters<typeof failureExplanation>[0], string, boolean][] = [
    ["validation", "Missing or invalid data", false],
    ["pendingSave", "Pending save", true],
    ["conflict", "Conflict", true],
    ["permission", "Permission", false],
    ["network", "Network", true],
    ["error", "Backend failure", true],
    ["duplicate", "Already submitted", false],
  ];
  for (const [reason, category, retryable] of cases) {
    const e = failureExplanation(reason, "Something happened.");
    assert.equal(e.category, category, reason);
    assert.equal(e.retryable, retryable, reason);
  }
});

test("a failure never suggests re-entering data that is already saved", () => {
  // §26.9: "Do not require the user to re-enter already saved data." The message
  // has to say so, because a red box after a submission reads as data loss.
  for (const reason of ["validation", "network", "error"] as const) {
    const e = failureExplanation(reason, "It failed.");
    assert.match(e.text, /still saved|untouched|nothing was lost|no saved data was lost/i, reason);
  }
});

// ── The receipt (§26.8) ─────────────────────────────────────────────────────

test("a successful submission reports month, year, user, time and id", () => {
  const lines = receiptLines({
    month: "2026-07",
    monthName: "July",
    year: 2026,
    userName: "Abhi Kamuju",
    submittedAt: "2026-08-04T18:30:00.000Z",
    submissionId: "5f3e-…-9c1",
    entriesSubmitted: 438,
    standardRows: 42,
  });
  const byLabel = Object.fromEntries(lines.map((l) => [l.label, l.value]));
  assert.equal(byLabel.Month, "July 2026");
  assert.equal(byLabel["Submitted by"], "Abhi Kamuju");
  assert.equal(byLabel["Submission ID"], "5f3e-…-9c1");
  assert.ok(byLabel["Submitted at"].length > 0);
  assert.equal(
    receiptHeadline({
      month: "2026-07", monthName: "July", year: 2026, userName: "x",
      submittedAt: "2026-08-04T18:30:00.000Z", submissionId: "id", entriesSubmitted: 1, standardRows: 1,
    }),
    "July Report was submitted successfully.",
  );
});
