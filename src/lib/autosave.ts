// The scheduling rules behind the grids' autosave, kept pure so they can be
// tested without a DOM or a server.
//
// Autosave on these two grids is not "write on every keystroke". Both pages are
// one big form over live production figures, and the failure modes that matter
// are (a) hammering the server while someone types a four-digit number, and
// (b) a save that starts before the previous one has landed and overwrites it
// with staler values. The rules below exist for those two.

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

// How long after the last keystroke a save fires. Long enough that typing
// "1420" is one save rather than four, short enough that looking away from the
// screen for a moment means the work is already safe.
export const AUTOSAVE_DELAY_MS = 1500;

// Should a scheduled autosave actually run right now?
//
// Deliberately conservative — every "no" here means the user's edit stays on
// screen and unsaved, which the status chip then says out loud. A wrong "yes"
// writes something nobody asked to write.
export function shouldAutosave(state: {
  // Edit Mode / the password gate. Autosave must never be the thing that
  // bypasses a gate the manual Save button respects — the Parts Cost cell had
  // exactly that bug once (a blur-autosave that skipped the ETC password) and
  // it was removed for it.
  enabled: boolean;
  // Nothing differs from what the server last sent.
  hasChanges: boolean;
  // A save is already in flight. Queue rather than race: two overlapping saves
  // of the same form can land out of order, and the loser silently reinstates
  // the values the winner had just replaced.
  inFlight: boolean;
  // Rows that exist only in the browser (Projects' "+ Add Project"). These are
  // validated as a batch — a blank Job Id rejects the WHOLE submission — so
  // autosaving one mid-typing would fail on every keystroke and bury the real
  // errors. They stay on the manual Save button.
  hasUnsavedNewRows: boolean;
}): boolean {
  if (!state.enabled) return false;
  if (state.inFlight) return false;
  if (state.hasUnsavedNewRows) return false;
  return state.hasChanges;
}

// After a save finishes, is another one owed?
//
// Edits made WHILE a save was in flight aren't in that save's payload, and the
// change event that would have scheduled them was swallowed by the inFlight
// check above. Without this they'd sit unsaved until the user happened to type
// again — the classic autosave data-loss bug.
export function needsFollowUpSave(state: { changedDuringSave: boolean; lastSaveOk: boolean }): boolean {
  // Not after a failure: retrying automatically against a server that just
  // rejected the write is how one bad value becomes a request loop. The chip
  // offers a Retry instead.
  if (!state.lastSaveOk) return false;
  return state.changedDuringSave;
}

// What the status chip says. Separate from the component so the wording is
// pinned by tests — "Saved" while an edit is actually still pending is the one
// message that would make someone close the tab on unsaved work.
export function autosaveLabel(status: AutosaveStatus): string {
  switch (status) {
    case "saving":
      return "Saving…";
    case "pending":
      return "Unsaved changes";
    case "saved":
      return "All changes saved";
    case "error":
      return "Save failed";
    default:
      return "";
  }
}
