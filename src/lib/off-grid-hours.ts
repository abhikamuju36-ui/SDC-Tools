import { SECTIONS } from "@/lib/sections";

// "Hours off the grid" — time booked to jobs whose EtcEntry rows exist for the month but
// which the grid no longer lists, because the job left Active status after the month was
// seeded. Those rows are deleted by the next Refresh Data or Submit ETC, so these hours
// are on a clock.
//
// Lives in lib/ rather than beside the card that renders it: the card is a client
// component that reaches a "use server" action, which makes it unimportable from a plain
// test. The arithmetic here is the part worth testing, so it is kept separable.

// One job whose hours exist in the month but which the grid does not list.
export type OffGridJob = {
  jobId: string;
  jobName: string;
  status: string | null;
  hours: number;
  sections: { section: string; hours: number }[];
};

export type OffGridSection = {
  section: string;
  name: string | undefined;
  hours: number;
  jobIds: string[];
};

// Section code -> its name. Built from the FULL section list rather than ETC_SECTIONS: an
// off-grid job's rows can carry codes the ETC grid excludes (the pool sections), and
// those still have real names.
const SECTION_NAME = new Map(SECTIONS.map((s) => [s.code, s.name]));

export function sectionName(code: string): string | undefined {
  return SECTION_NAME.get(code);
}

// The off-grid hours rolled up by SECTION instead of by job (2026-08-03, by request:
// "split by the sections"). The two views answer different questions — "which jobs am I
// about to lose hours on" versus "which kinds of work" — and the second is what tells you
// whether the loss lands on engineering or on the floor.
//
// Both views must total the same figure as the card above them, since all three are on
// screen at once. Hence the tests: a rollup that dropped or double-counted a job's hours
// would put three different numbers in front of the reader for one thing.
//
// Sorted by hours descending — biggest loss first.
export function offGridBySection(jobs: OffGridJob[]): OffGridSection[] {
  const map = new Map<string, OffGridSection>();
  for (const j of jobs) {
    for (const s of j.sections) {
      const cur = map.get(s.section) ?? { section: s.section, name: SECTION_NAME.get(s.section), hours: 0, jobIds: [] };
      cur.hours += s.hours;
      // A job contributes to a section at most once (rows are summed per section
      // upstream), but guard anyway so a repeat can't double-list the job id.
      if (!cur.jobIds.includes(j.jobId)) cur.jobIds.push(j.jobId);
      map.set(s.section, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.hours - a.hours || a.section.localeCompare(b.section));
}
