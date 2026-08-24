// ── Textual job cells in the Paylocity export ───────────────────────────────
//
// Most job cells are a number ("1105"). A few are a NAME, because Paylocity
// carries standing overhead categories that were never given a job number
// upstream. Observed in the live files (2026-08-24), with their unattributed
// hours at the time:
//
//   "2025 SERVICE"   781.75h   <- a Job row exists: jobId 10001, "2025 Service"
//   "2026 SERVICE"    63.27h
//   "2024_SER"        17.17h
//   "2023_SER"         9.73h
//   "Not Defined"  16659.20h   <- genuinely uncoded; not a job, must NOT resolve
//   "1037-02"         25.95h   <- a machine-suffixed job number; separate problem
//
// paylocity-workbook.ts rejected every one of these with JOB_NOT_FOUND, because
// its job lookup starts with `Number(rawJob)` and anything non-finite is not a
// job. So 871.92h of Service work across four years never reached the app —
// including the 63.27h that prompted this, and 781.75h whose Job row already
// existed and was simply never matched to the label.
//
// ── Matched by NAME, never by numeric prefix ────────────────────────────────
//
// This is the one hard rule. "2026 SERVICE" and "2026 Spare Parts" are separate
// Paylocity categories that happen to share a leading 2026, and job number 2026
// IS "2026 Spare Parts". Keying on the prefix would silently merge Service hours
// into Spare Parts. So the key is the whole normalized name: "2026 service"
// cannot collide with "2026 spare parts".
//
// ── Why matching against Job.jobName rather than a hardcoded table ──────────
//
// A per-year lookup table would need editing every January, and a year nobody
// remembered to add would fail silently — the failure this is fixing. Resolving
// against whatever Job rows exist means creating a "2026 Service" job is all it
// takes for those punches to start flowing, with no code change. That is the
// "future Service punches automatically flow through" requirement.
//
// Dependency-free so `tsx --test` can load it without exceljs.

/**
 * Canonical key for a job NAME, from either side of the match — a Paylocity job
 * cell or a `Job.jobName`. Two spellings of the same job must produce the same
 * key; two different jobs must not.
 *
 * Handles the abbreviations actually present in the files and nothing more:
 * underscores as separators, and a trailing SER/SERV token meaning "Service"
 * ("2023_SER" -> "2023 service"). Deliberately NOT a general abbreviation
 * expander — inventing equivalences here is how two genuinely different jobs
 * end up sharing a key.
 *
 * Returns "" for anything that cannot be a job name, so a caller can treat the
 * empty string as "do not attempt a name match" rather than matching a job whose
 * name is also empty.
 */
export function normalizeJobLabel(raw: string | null | undefined): string {
  if (raw == null) return "";
  const cleaned = String(raw)
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    // Keep alphanumerics and spaces; drop punctuation that varies between the
    // export and the job master ("2025 Service." / "2025-Service").
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return "";
  // Expand the abbreviated Service token, but only as a WHOLE word, so a job
  // legitimately named e.g. "Sermatech" is untouched.
  return cleaned
    .split(" ")
    .map((w) => (w === "ser" || w === "serv" ? "service" : w))
    .join(" ");
}

/**
 * Labels that must never resolve to a job even if some job happens to normalize
 * to the same key. "Not Defined" is Paylocity's own marker for a punch nobody
 * coded — 16,659h of it — and attributing it to a job would be inventing data,
 * not mapping it.
 */
const NEVER_A_JOB = new Set(["not defined", "notdefined", "none", "n a", "na", "unassigned", "blank"]);

/**
 * Resolve a textual job cell to a job number, or null.
 *
 * `jobIdByLabel` is built from the Job table by the caller (see hours-feed.ts),
 * keyed with this same normalizer so both sides agree by construction.
 */
export function resolveJobLabel(raw: string | null | undefined, jobIdByLabel: ReadonlyMap<string, string>): string | null {
  const key = normalizeJobLabel(raw);
  if (!key || NEVER_A_JOB.has(key)) return null;
  return jobIdByLabel.get(key) ?? null;
}

/**
 * Build the label -> jobId index from the job master.
 *
 * A name shared by two jobs is dropped rather than resolved arbitrarily: picking
 * one would attribute real hours to a coin flip. Such a collision is a data
 * problem for whoever owns the job master, and leaving those punches as
 * JOB_NOT_FOUND is what keeps it visible.
 */
export function buildJobLabelIndex(jobs: readonly { jobId: string; jobName: string | null }[]): Map<string, string> {
  const byLabel = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const j of jobs) {
    const key = normalizeJobLabel(j.jobName);
    if (!key || NEVER_A_JOB.has(key)) continue;
    if (byLabel.has(key) && byLabel.get(key) !== j.jobId) ambiguous.add(key);
    else byLabel.set(key, j.jobId);
  }
  for (const key of ambiguous) byLabel.delete(key);
  return byLabel;
}
