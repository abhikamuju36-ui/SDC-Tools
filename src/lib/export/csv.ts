import type { CellValue, SheetSpec } from "@/lib/export/sheet";

// ── CSV, the way Excel actually reads it (§24.6) ─────────────────────────────
//
// RFC 4180 quoting, CRLF line endings, and a UTF-8 BOM. The BOM is the difference
// between a customer name with an accent in it arriving correctly and arriving as
// mojibake: Excel on Windows assumes the system codepage for a .csv unless it sees one.
// It is also why this is a hand-written serialiser rather than a join — the rules are
// small, exact, and worth being able to test.
//
// What each value becomes, and why:
//   * null      -> nothing at all (,,) so a cleared cell stays BLANK. Writing "0" or
//                  "null" here would be the export re-introducing the very bug DEVLOG
//                  §16 was about.
//   * 0         -> "0". A zero is a figure somebody entered.
//   * number    -> raw digits, no thousands separators, no currency symbol. The file is
//                  data; formatting belongs to the XLSX export.
//   * Date      -> ISO yyyy-mm-dd. Unambiguous, sorts correctly as text, and Excel
//                  recognises it as a date on import.
//   * string    -> quoted only when it has to be.

export function csvCell(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    // NaN/Infinity would land in the file as "NaN" and poison a column's type. A figure
    // that cannot be represented is better shown as blank than as a word.
    if (!Number.isFinite(value)) return "";
    return String(value);
  }
  const s = String(value);
  // A leading = + - @ makes Excel treat the cell as a formula. Job names and customer
  // names are free text from upstream systems, so a cell starting with one of those is
  // prefixed with a single quote — Excel shows the text and does not evaluate it. This
  // is the CSV-injection guard, and it matters because these files get opened by people
  // who did not create them.
  const escaped = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(escaped) ? `"${escaped.replace(/"/g, '""')}"` : escaped;
}

export function csvRow(values: CellValue[]): string {
  return values.map(csvCell).join(",");
}

// The whole file. `﻿` first, CRLF between rows — what Excel expects from a CSV it
// did not write itself.
export function buildCsv(spec: SheetSpec): string {
  const lines: string[] = [];
  // Context above the table: which report, which period, when it was taken. A CSV that
  // says only "1,234" tells a reader nothing three weeks later.
  lines.push(csvRow([spec.title]));
  for (const line of spec.subtitle) lines.push(csvRow([line]));
  lines.push("");
  lines.push(csvRow(spec.columns.map((c) => (c.group ? `${c.group} - ${c.header}` : c.header))));
  for (const row of spec.rows) lines.push(csvRow(row));
  if (spec.totals) lines.push(csvRow(spec.totals));
  return `﻿${lines.join("\r\n")}\r\n`;
}
