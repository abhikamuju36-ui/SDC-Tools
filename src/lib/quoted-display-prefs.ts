// Display prefs for the Projects grid.
//
// "Actual hours in cells" used to live in localStorage, mirrored onto a <body>
// class by an effect in ProjectsDisplayMenu, while everything else about the
// view lived in the URL. That split is what made the Show-all switch unreliable:
// one click had to write localStorage AND push a new URL, so the server
// re-rendered the grid from the URL while the actuals half of the same click
// depended on a body class that a sibling component happened to set in an effect
// afterwards. The two could land in either order, and the markup the server sent
// never reflected the toggle at all — every load and every navigation painted
// the suffix first and hid it a frame later.
//
// It's now just another view param, so a single navigation carries the whole
// state and the server renders it directly: one source of truth, no effect, no
// flash, and a link you paste to someone shows them the same thing you see.
// Absent = off, which is the page's default.
export const ACTUALS_PARAM = "actuals";

export function isActualsOn(params: { get(name: string): string | null }): boolean {
  return params.get(ACTUALS_PARAM) === "1";
}

// The view params the Projects grid's "Show all / Reset" switch owns. Listed
// once so flipping to Reset can't miss one — a leftover param would leave the
// grid half-reset, which is the failure nobody would report as a bug.
export const QUOTED_VIEW_PARAMS = ["customers", "types", "statuses", "billables", "cols", "hide", ACTUALS_PARAM] as const;

// ── Multi-value params are comma-joined, and 16 of 88 customer names contain a
// comma ("FIRST SOLAR, INC.", "Alcon Research, LTD", "Tarkett USA, Inc.") ────
// A raw `values.join(",")` is therefore ambiguous: the page splits it back on
// commas and gets "FIRST SOLAR" + " INC.", which match no job at all, so those
// customers' rows silently vanish — and `isShowingAll` can never see the intact
// name it wrote, so the Show-all switch reads OFF straight after being turned
// on. Both symptoms traced to this one line.
//
// Fixed by escaping the separator inside each value rather than changing the
// URL shape: `%2C` for a comma, `%25` for a literal percent so the escape is
// reversible. Decoding is a single pass over both tokens, not two sequential
// replaces — sequential ones would turn a name containing a literal "%2C" into
// a comma. URLSearchParams re-encodes the `%` on the way out, so the round trip
// through the query string is lossless.
//
// Every writer of these params must go through encodeParamList and every reader
// through decodeParamList; a raw join/split anywhere reintroduces the bug for
// exactly the values nobody tests with.
export function encodeParamList(values: string[]): string {
  return values.map((v) => v.replace(/[%,]/g, (c) => (c === "%" ? "%25" : "%2C"))).join(",");
}

export function decodeParamList(raw: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .filter(Boolean)
    .map((v) => v.replace(/%(25|2C)/g, (_m, hex) => (hex === "25" ? "%" : ",")));
}

export type ShowAllOptions = {
  customers: string[];
  types: string[];
  statuses: string[];
  billables: string[];
  cols: string[];
};

// Is EVERYTHING currently visible? Pure, and separate from the component, because
// the subtlety is worth testing: on this grid an absent param means "no choice
// made yet, use the narrower default" — so absent must read as NOT-all, even
// though an absent `hide` does mean nothing is hidden. Those two asymmetric
// cases are exactly what a refactor would get wrong.
// Takes anything with a `get`, so it accepts both a plain URLSearchParams (tests)
// and Next's ReadonlyURLSearchParams (the component) without a cast.
export function isShowingAll(params: { get(name: string): string | null }, all: ShowAllOptions): boolean {
  if (!isActualsOn(params)) return false;
  if (params.get("hide")) return false; // any hidden info column -> not all
  const covers = (param: keyof ShowAllOptions) => {
    const raw = params.get(param);
    if (raw === null) return false; // absent = the default, which is narrower
    const have = new Set(decodeParamList(raw));
    return all[param].every((v) => have.has(v));
  };
  return covers("customers") && covers("types") && covers("statuses") && covers("billables") && covers("cols");
}
