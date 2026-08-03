import { test } from "node:test";
import assert from "node:assert/strict";
import { offGridBySection, type OffGridJob } from "../src/lib/off-grid-hours";

// "Hours off the grid", split by section (2026-08-03, by request).
//
// The invariant to protect: the by-section view and the by-job view must total the same
// figure, because the card above them shows that total too and all three are on screen
// at once. A section rollup that dropped or double-counted a job's hours would put three
// different numbers in front of the reader for the same thing.

// July 2026's actual off-grid set, from the drill panel.
const JULY: OffGridJob[] = [
  {
    jobId: "4000",
    jobName: "Non-Billable",
    status: "Active",
    hours: 170,
    sections: [
      { section: "10-313", hours: 71 },
      { section: "10-211", hours: 37 },
      { section: "10-411", hours: 33 },
      { section: "10-312", hours: 29 },
    ],
  },
  { jobId: "1083", jobName: "SDC Showroom", status: "Active", hours: 7, sections: [{ section: "10-412", hours: 7 }] },
  { jobId: "7000", jobName: "Team Inititives", status: "Active", hours: 4, sections: [{ section: "10-312", hours: 4 }] },
];

const jobTotal = (jobs: OffGridJob[]) => jobs.reduce((s, j) => s + j.hours, 0);
const sectionTotal = (jobs: OffGridJob[]) => offGridBySection(jobs).reduce((s, x) => s + x.hours, 0);

test("the two views total the same hours", () => {
  assert.equal(jobTotal(JULY), 181);
  assert.equal(sectionTotal(JULY), 181);
});

test("a section shared by two jobs is summed, and both jobs are named", () => {
  // 10-312 is 29h on job 4000 and 4h on job 7000. Getting this wrong is the whole
  // reason a rollup can disagree with its source.
  const rows = offGridBySection(JULY);
  const shared = rows.find((r) => r.section === "10-312")!;
  assert.equal(shared.hours, 33);
  assert.deepEqual(shared.jobIds, ["4000", "7000"]);
});

test("one row per distinct section, no duplicates", () => {
  const rows = offGridBySection(JULY);
  assert.equal(rows.length, 5); // 10-313, 10-211, 10-411, 10-312, 10-412
  assert.equal(new Set(rows.map((r) => r.section)).size, rows.length);
});

test("sorted by hours descending — biggest loss first", () => {
  const rows = offGridBySection(JULY);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].hours <= rows[i - 1].hours, `not sorted at ${i}`);
  }
  assert.equal(rows[0].section, "10-313");
  assert.equal(rows[0].hours, 71);
});

test("section codes are given their names", () => {
  const rows = offGridBySection(JULY);
  assert.equal(rows.find((r) => r.section === "10-211")!.name, "ME Gen");
  assert.equal(rows.find((r) => r.section === "10-312")!.name, "Design & Drawings");
});

test("an unrecognised code still counts, just unnamed", () => {
  // Dropping it would break the totals; the code alone is still actionable.
  const rows = offGridBySection([
    { jobId: "9999", jobName: "Odd", status: null, hours: 5, sections: [{ section: "99-999", hours: 5 }] },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hours, 5);
  assert.equal(rows[0].name, undefined);
});

test("no off-grid jobs means no rows and a zero total", () => {
  assert.deepEqual(offGridBySection([]), []);
  assert.equal(sectionTotal([]), 0);
});

test("a job listed twice for one section cannot double-list the job id", () => {
  // Upstream sums per section, so this shouldn't arise — but the hours must still add
  // up and the job must appear once.
  const rows = offGridBySection([
    {
      jobId: "4000",
      jobName: "Non-Billable",
      status: "Active",
      hours: 10,
      sections: [
        { section: "10-211", hours: 6 },
        { section: "10-211", hours: 4 },
      ],
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hours, 10);
  assert.deepEqual(rows[0].jobIds, ["4000"]);
});

test("fractional hours are not rounded away in the rollup", () => {
  const rows = offGridBySection([
    { jobId: "1", jobName: "a", status: null, hours: 0.4, sections: [{ section: "10-211", hours: 0.4 }] },
    { jobId: "2", jobName: "b", status: null, hours: 0.3, sections: [{ section: "10-211", hours: 0.3 }] },
  ]);
  assert.ok(Math.abs(rows[0].hours - 0.7) < 1e-9);
});
