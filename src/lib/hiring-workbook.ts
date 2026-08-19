import "server-only";
import { readFile } from "fs/promises";
import { parseHiringWorkbook, HiringWorkbookError } from "@/lib/hiring-workbook-parse";
import type { HiringPositionSourceRow } from "@/lib/hiring-workbook-parse";

export type { HiringPositionSourceRow };
export { HiringWorkbookError, isOpenPosition, parseHiringWorkbook, SHEET_NAME, REQUIRED_HEADERS } from "@/lib/hiring-workbook-parse";

// ── The open-positions workbook, read straight off disk (2026-08-19) ────────
//
// A Paylocity Recruiting "Job" report, dropped at
// `C:\Users\akamuju\Steven Douglas Corp\Finance - General\New Hire\Job.xlsx` —
// confirmed by reading the live file directly. Same local-file convention as
// lib/paylocity-workbook.ts: an env var pointing at the real path, falling
// back to the path this was built against, so a deployment on a different
// machine only needs the env var set, never a code change.
//
// Parsing itself lives in hiring-workbook-parse.ts (no `fs`, no
// "server-only", directly unit-testable) — this file is only the disk read.

const DEFAULT_PATH = String.raw`C:\Users\akamuju\Steven Douglas Corp\Finance - General\New Hire\Job.xlsx`;

export function hiringWorkbookPath(): string {
  return process.env.HIRING_POSITIONS_LOCAL_PATH?.trim() || DEFAULT_PATH;
}

export async function readHiringWorkbook(): Promise<HiringPositionSourceRow[]> {
  const path = hiringWorkbookPath();
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch (err) {
    throw new HiringWorkbookError(
      "file_missing",
      `Couldn't read the hiring positions workbook at "${path}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseHiringWorkbook(buf);
}
