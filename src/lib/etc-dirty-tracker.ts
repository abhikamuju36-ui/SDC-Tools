"use client";

// Tracks whether any New ETC cell currently holds an edit that hasn't been
// saved — a plain module-scope store (not React state/context) so every
// independent EtcSectionCells instance, the Save button and the navigation
// guards can share it without prop-drilling through the whole grid (same
// no-context spirit as ColumnResize.tsx). Backs the beforeunload warning and
// the "unsaved changes" confirms in MonthYearSelect and the Sidebar.
//
// This used to be a single `let dirty = false` latch that only markEtcDirty()
// set and only a successful Save cleared. Two things were wrong with that,
// and together they meant the warning fired constantly on a grid nobody had
// touched (reported 2026-08-02):
//
//   1. It never reset on navigation. Module scope outlives a client-side route
//      change, so one keystroke anywhere — in a month you then left, or a
//      cell you emptied again — armed the warning for the REST OF THE BROWSER
//      SESSION. Every later month switch, refresh, Back and Sign out asked to
//      save work that didn't exist.
//   2. It latched on the change EVENT, not on the value. Typing "5" and
//      backspacing it left the grid "dirty" with every cell exactly as it was
//      loaded.
//
// So dirtiness is now a property of the CURRENT VALUES: each field registers
// the value it loaded with, reports its value as it changes, and drops out of
// the dirty set the moment it matches its baseline again. Fields unregister on
// unmount, which is what makes a month switch self-cleaning — the grid form is
// keyed on the month, so every cell unmounts and takes its entry with it. No
// reset hook to call, and no ordering hazard between "reset" and "register".

// field name -> the value it should be compared against (normalized).
// Seeded on mount, moved forward by rebaseline() when a Save persists.
const baselines = new Map<string, string>();
// The subset of registered fields whose current value differs from baseline.
const dirtyFields = new Set<string>();

// "5", "5.0", " 5 " and "5.00" are the same number typed four ways, and a
// <input type="number"> hands back whichever one was keyed. Comparing raw
// strings would call a cell dirty for a formatting difference the manager
// can't even see. Blank normalizes to "" (distinct from any number, including
// zero — an empty New ETC is "not decided", not "nothing left to do").
function normalize(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const n = Number(trimmed);
  // Non-numeric text is kept verbatim rather than collapsed to NaN, so two
  // different unparseable entries don't compare equal.
  return Number.isFinite(n) ? String(n) : trimmed;
}

// Call on mount with the value the field rendered with. Idempotent on name:
// a re-register (React StrictMode's double-invoke in dev) must not clobber a
// baseline that rebaseline() has since moved forward.
export function registerEtcField(name: string, initial: string): void {
  if (!baselines.has(name)) baselines.set(name, normalize(initial));
}

// Call on unmount. Removing the baseline as well as the dirty entry is what
// keeps a stale month's fields from lingering in the store forever.
export function forgetEtcField(name: string): void {
  baselines.delete(name);
  dirtyFields.delete(name);
}

// Call on every change. Deliberately two-way: a field that returns to its
// baseline is clean again, which is the half the old latch got wrong.
export function updateEtcField(name: string, value: string): void {
  const baseline = baselines.get(name);
  // Unregistered field — nothing to compare against, so treat any value as an
  // edit rather than silently ignoring it.
  if (baseline === undefined) {
    dirtyFields.add(name);
    return;
  }
  if (normalize(value) === baseline) dirtyFields.delete(name);
  else dirtyFields.add(name);
}

// After a Save (or Submit) persists what's on screen, the values that were
// posted BECOME the baseline — otherwise the next edit would be compared
// against what the page originally loaded with and a cell typed back to its
// pre-save value would read as clean when it isn't.
//
// Takes the posted FormData so the caller doesn't have to know which fields
// exist; only names already registered are touched, so unrelated form fields
// (hours, passwords) can't create phantom baselines.
export function rebaselineEtcFields(formData: FormData): void {
  for (const name of baselines.keys()) {
    const posted = formData.get(name);
    if (posted === null) continue; // not in this submission (a filtered-out column)
    baselines.set(name, normalize(String(posted)));
    dirtyFields.delete(name);
  }
}

export function isEtcDirty(): boolean {
  return dirtyFields.size > 0;
}
