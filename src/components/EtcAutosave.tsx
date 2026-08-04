"use client";

import { useEffect, useRef } from "react";
import { saveAllNewEtcDrafts } from "@/lib/etc-actions";
import {
  changedEtcFormData,
  hasUnrefusedEtcEdits,
  isEtcDirty,
  markEtcFieldsRefused,
  rebaselineEtcFields,
} from "@/lib/etc-dirty-tracker";
import { useAutosave } from "@/components/useAutosave";
import { SaveStatusChip } from "@/components/SaveStatusChip";
import { requestLiveRefresh, registerRefreshBlocker } from "@/components/LiveRefresh";

// Autosave for the Monthly ETC grid's New ETC cells.
//
// ── Always on, on any unlocked month (2026-08-04) ────────────────────────────
// This used to require `unlocked` — the session cookie the manual Save set once a
// password had been entered. That made autosave the opposite of a safety net: on a
// fresh browser session it wrote nothing, so a manager could fill in the grid, hit a
// password popover, and lose the lot on the next refresh. Reported twice as "Save is
// not working"; the audit log showed zero draft saves while it was happening.
//
// The old argument for gating it was consistency — an autosave that bypassed a gate the
// Save button respected would make the gate decorative. That argument is now moot in
// the right direction: the DRAFT save has no gate at all (see saveAllNewEtcDrafts), so
// there is nothing to bypass. The gates that matter still stand on the actions that
// freeze or destroy: Submit ETC, Clear ETC, Reopen Month, Sync History.
//
// `locked` is still respected: a submitted month is frozen history and nothing here
// may touch it.
//
// ── Drafts, not submissions ─────────────────────────────────────────────────
// This writes newEtcDraft, exactly as the Save button does. It never submits or
// locks a month: Submit ETC stays a deliberate, separately-confirmed act.
export function EtcAutosave({ formId, month, locked }: { formId: string; month: string; locked: boolean }) {
  const formRef = useRef<HTMLFormElement | null>(null);
  // The toolbar sits OUTSIDE this form (the grid form opens further down the
  // page), so it is reached by id — the same way SaveEtcDraftsButton does it.
  useEffect(() => {
    const el = document.getElementById(formId);
    formRef.current = el instanceof HTMLFormElement ? el : null;
  }, [formId]);

  const enabled = !locked;

  // Hold off the BACKGROUND refresh while there is unsaved typing on the grid.
  // The cells protect a user's own edit either way (they only adopt a server value
  // when clean), so this is about not re-rendering 450 cells under someone's hands
  // mid-thought. Unsaved state is transient — autosave fires 800ms after the last
  // keystroke — so convergence is delayed by seconds, not blocked.
  //
  // Explicit requestLiveRefresh() calls ignore blockers on purpose: a refused write
  // has to be corrected on screen immediately.
  //
  // hasUnrefusedEtcEdits, NOT isEtcDirty: a cell the server refused stays dirty by
  // design, and blocking on it would deadlock this tab — the refusal keeps it dirty,
  // the dirt keeps the refresh off, and the refresh is the only thing that would show
  // the manager the figure they now have to reconcile against.
  useEffect(() => registerRefreshBlocker(() => hasUnrefusedEtcEdits()), []);

  const { status, schedule, retry } = useAutosave({
    enabled,
    // The value-based tracker, so a cell typed and put back the way it was
    // doesn't trigger a write.
    hasChanges: () => isEtcDirty(),
    save: async () => {
      const form = formRef.current;
      if (!form) return false;
      // Only the cells THIS user edited (2026-08-04). `new FormData(form)` posted
      // all ~450, and every one of them that differed from the database was
      // written — so a second manager's open tab wrote its page-load values back
      // over everything the first had saved. See changedEtcFormData.
      const fd = changedEtcFormData(form);
      const result = await saveAllNewEtcDrafts(month, fd);
      // Re-baseline from exactly what was posted, so the next edit is compared
      // against the saved values rather than what the page first loaded with.
      if (result.ok) rebaselineEtcFields(fd, result.conflictFields);
      // A refused write means somebody else changed that cell first. Pull the
      // real values in so the manager is looking at what is actually stored
      // rather than retyping against a figure that is already gone.
      if (result.conflicts > 0) {
        markEtcFieldsRefused(result.conflictFields);
        requestLiveRefresh();
      }
      return result.ok;
    },
  });

  useEffect(() => {
    if (!enabled) return;
    const form = formRef.current;
    if (!form) return;
    // Delegated at the form: this grid renders a New ETC input per job per
    // tracked section, and they re-mount whenever the month or the column
    // filters change.
    const onEdit = (e: Event) => {
      const t = e.target;
      // Only the manager-entered cells. Hours Worked rides along in the form as
      // a hidden input and is Power-BI-owned; nothing else here is editable,
      // but naming the field explicitly keeps a future input from silently
      // joining the autosave.
      //
      // BOTH New ETC field namespaces, not just the override one. A section a job
      // was never quoted for has no EtcEntry yet, so its cell posts
      // `newEtcCreate__<jobId>__<section>` instead (see EtcSectionCells) — and
      // that was half of July's grid, 357 of 754 cells. Watching only the
      // override prefix meant typing in any of them scheduled nothing: autosave
      // was genuinely dead for those cells until the manager happened to touch a
      // quoted one, which then swept them in via the shared FormData. The manual
      // Save button always handled both (parseNewEtcCreateFields).
      if (!(t instanceof HTMLInputElement)) return;
      // Parts Cost opts in by attribute rather than by name: its visible input has
      // no `name` (the name is on a hidden input beside it), so a name match missed
      // it entirely and typing there scheduled nothing. See PartsCostNewEtcCell.
      if (t.dataset.etcAutosave === "1") {
        schedule();
        return;
      }
      if (t.name.startsWith("newEtcOverride__") || t.name.startsWith("newEtcCreate__")) schedule();
    };
    form.addEventListener("input", onEdit);
    return () => form.removeEventListener("input", onEdit);
  }, [enabled, schedule]);

  if (!enabled) return null;
  return <SaveStatusChip status={status} onRetry={retry} />;
}
