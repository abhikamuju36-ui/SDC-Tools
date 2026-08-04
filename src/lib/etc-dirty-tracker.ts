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

// The server has sent a new value for this field and the cell has adopted it
// (because the user had not diverged from the old one) — so THAT is what
// "unchanged" means from now on.
//
// Distinct from registerEtcField, which is deliberately idempotent and must not
// clobber a baseline that has moved. This one overwrites, and it is only ever
// called with a value the cell is actually displaying.
//
// Without this, adopting another user's saved figure would leave the cell compared
// against the value the PAGE loaded with: it would read as dirty, autosave would
// post it, and the server's stale-write guard would reject it as a conflict — so
// picking up a colleague's change would produce a spurious "changed by another
// user" warning on a cell nobody had touched.
export function adoptEtcFieldBaseline(name: string, value: string): void {
  baselines.set(name, normalize(value));
  dirtyFields.delete(name);
  refusedFields.delete(name);
}

// Call on unmount. Removing the baseline as well as the dirty entry is what
// keeps a stale month's fields from lingering in the store forever.
export function forgetEtcField(name: string): void {
  baselines.delete(name);
  dirtyFields.delete(name);
  refusedFields.delete(name);
}

// Call on every change. Deliberately two-way: a field that returns to its
// baseline is clean again, which is the half the old latch got wrong.
export function updateEtcField(name: string, value: string): void {
  // Typing in a refused cell is the manager dealing with the conflict, so it stops
  // being one — and the background refresh is free to resume once it saves.
  refusedFields.delete(name);
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
//
// `refused` names the fields the server did NOT write — cells another user had
// already changed (saveAllNewEtcDrafts's stale-write guard). Re-baselining those
// would be a lie in the one place it matters most: the cell would stop reading as
// dirty, the status chip would say "All changes saved", and the manager's value —
// which the server rejected — would sit on screen looking persisted until the next
// reload silently replaced it. Leaving them dirty is what keeps the unsaved-changes
// warning honest.
export function rebaselineEtcFields(formData: FormData, refused?: Iterable<string>): void {
  const skip = refused ? new Set(refused) : null;
  for (const name of baselines.keys()) {
    if (skip?.has(name)) continue;
    const posted = formData.get(name);
    if (posted === null) continue; // not in this submission (a filtered-out column)
    baselines.set(name, normalize(String(posted)));
    dirtyFields.delete(name);
    refusedFields.delete(name);
  }
}

export function isEtcDirty(): boolean {
  return dirtyFields.size > 0;
}

// ── Cells the server refused, so the refresh interlock can ignore them ──────
//
// A refused cell stays DIRTY on purpose — the manager's value was rejected and is
// genuinely unsaved, so the unsaved-changes warnings must keep covering it. But
// LiveRefresh suppresses its background refresh while anything is dirty, and that
// combination deadlocks the tab: the refusal keeps it dirty, the dirt keeps the
// refresh off, and the refresh is the only thing that would show the manager the
// figure they now have to reconcile against (found by review, 2026-08-04).
//
// So refusals are remembered separately and excluded from the REFRESH question
// only. A field leaves the set the moment its value changes or it re-baselines —
// either way the conflict has been dealt with.
const refusedFields = new Set<string>();

export function markEtcFieldsRefused(names: Iterable<string>): void {
  for (const n of names) refusedFields.add(n);
}

// Unsaved edits that are NOT sitting on a known refusal. This is what gates the
// background refresh; isEtcDirty() (which still counts them) is what gates the
// "you have unsaved changes" warnings.
export function hasUnrefusedEtcEdits(): boolean {
  for (const name of dirtyFields) if (!refusedFields.has(name)) return true;
  return false;
}

// ── Only send what this user actually touched ────────────────────────────────
//
// THE MULTI-USER BUG (reported 2026-08-04, "other users are not seeing the value
// I saved"). The Monthly ETC grid is one <form>, and the save posted
// `new FormData(form)` — all ~450 New ETC cells, every time. Each posted value
// that differed from the database got written. So a second manager with the page
// open was not merely looking at stale numbers: their next autosave pass wrote
// their page-load-time values back over every cell the first manager had saved
// since. The value did not fail to appear, it was actively reverted, which is
// why it looked permanent rather than like a refresh problem.
//
// The fix is to post the cells this user has edited and nothing else. The server
// already treats an ABSENT field as "not rendered — leave it untouched"
// (saveAllNewEtcDrafts), so an omitted cell is precisely a cell this save has no
// opinion about. That was already the contract; the client was just ignoring it.
//
// This mirrors what the Projects grid has done since 2026-08-03 (lib/dirty-form.ts,
// `changedFormData`) — that grid trims its payload the same way, for what was then
// only a performance reason. Same rule, and now the same correctness reason.
//
// `newEtcBase__*` rides along: the value this client believed was stored. The
// server refuses the write if the database has moved since (see
// saveAllNewEtcDrafts), which is what makes this safe even against a browser tab
// running an older bundle that still posts everything.
export const ETC_BASE_PREFIX = "newEtcBase__";

export function dirtyEtcFieldNames(): string[] {
  return [...dirtyFields];
}

// The trimmed payload for one ETC draft save. Values are read from the LIVE form
// control rather than from the tracker, so what gets posted is what is on screen
// — the tracker's job is only to say WHICH fields to look at.
export function changedEtcFormData(form: HTMLFormElement): FormData {
  const fd = new FormData();
  for (const name of dirtyFields) {
    const el = form.elements.namedItem(name);
    // Gone from the DOM (a column filter hid it, a month switch unmounted it).
    // Skipping is right: there is nothing on screen to save, and posting a
    // remembered value would be exactly the stale write this exists to prevent.
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    if (el.disabled) continue;
    fd.append(name, el.value);
    // "" means "this client believes no draft is stored". Distinct from a stored
    // 0, which posts as "0".
    fd.append(`${ETC_BASE_PREFIX}${stripEtcFieldPrefix(name)}`, baselines.get(name) ?? "");
  }
  return fd;
}

// `newEtcOverride__123` -> `123`, `newEtcCreate__9__10-211` -> `9__10-211`. The
// base field is keyed by the same suffix so the server can pair them up without
// re-deriving which namespace a cell came from.
export function stripEtcFieldPrefix(name: string): string {
  return name.replace(/^newEtcOverride__/, "").replace(/^newEtcCreate__/, "");
}

// ── Baselines for a NATIVE submit ───────────────────────────────────────────
//
// Submit and Lock cannot trim its payload the way the draft save does — it needs
// `hoursWorked__<id>` for every entry in the month, and it posts through
// requestSubmit() so React serialises the form itself. So instead of choosing what
// to send, it declares what it BELIEVED: a hidden field per registered cell,
// injected into the DOM just before submitting.
//
// Why Submit needs this at all (found by review, 2026-08-04). submitMonth writes
// the posted value into `newEtc` — CONFIRMED history, frozen for the month. A tab
// whose grid had gone stale would therefore freeze its own snapshot over whatever
// colleagues had saved since, and unlike a draft that is not something the next
// save can put right. With a baseline the server can tell "this user typed this"
// from "this is just what my page loaded with", and prefer the stored draft for
// the latter.
//
// Idempotent: re-uses the hidden input if it is already there, so submitting twice
// does not accumulate duplicates.
export function injectEtcBaselineFields(form: HTMLFormElement): number {
  let n = 0;
  for (const [name, baseline] of baselines) {
    const fieldName = `${ETC_BASE_PREFIX}${stripEtcFieldPrefix(name)}`;
    const existing = form.elements.namedItem(fieldName);
    if (existing instanceof HTMLInputElement) {
      existing.value = baseline;
    } else {
      const el = document.createElement("input");
      el.type = "hidden";
      el.name = fieldName;
      el.value = baseline;
      form.appendChild(el);
    }
    n++;
  }
  return n;
}
