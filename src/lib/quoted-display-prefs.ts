// Client-side display prefs for the Projects grid that live in localStorage
// rather than the URL — currently just the "actual hours in cells" flag.
//
// Extracted so the Display menu and the Show-all switch can't drift: both need to
// read it, write it, and be told when the other one changed it. A localStorage
// write doesn't notify the tab that made it, hence the explicit event.
export const ACTUALS_KEY = "quoted-show-actuals";
export const ACTUALS_EVENT = "quoted-show-actuals-change";

export function readShowActuals(): boolean {
  return window.localStorage.getItem(ACTUALS_KEY) === "1";
}

export function writeShowActuals(next: boolean): void {
  window.localStorage.setItem(ACTUALS_KEY, next ? "1" : "0");
  window.dispatchEvent(new Event(ACTUALS_EVENT));
}

// The view params the Projects grid's "Show all / Reset" switch owns. Listed
// once so flipping to Reset can't miss one — a leftover param would leave the
// grid half-reset, which is the failure nobody would report as a bug.
export const QUOTED_VIEW_PARAMS = ["customers", "types", "statuses", "billables", "cols", "hide"] as const;

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
export function isShowingAll(
  params: { get(name: string): string | null },
  all: ShowAllOptions,
  actualsOn: boolean,
): boolean {
  if (!actualsOn) return false;
  if (params.get("hide")) return false; // any hidden info column -> not all
  const covers = (param: keyof ShowAllOptions) => {
    const raw = params.get(param);
    if (raw === null) return false; // absent = the default, which is narrower
    const have = new Set(decodeParamList(raw));
    return all[param].every((v) => have.has(v));
  };
  return covers("customers") && covers("types") && covers("statuses") && covers("billables") && covers("cols");
}

// For useSyncExternalStore. Also listens for `storage`, which covers the same
// page open in a second tab.
export function subscribeShowActuals(onChange: () => void): () => void {
  window.addEventListener(ACTUALS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(ACTUALS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
