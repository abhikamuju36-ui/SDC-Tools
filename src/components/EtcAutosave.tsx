"use client";

import { useEffect, useRef } from "react";
import { saveAllNewEtcDrafts } from "@/lib/etc-actions";
import { isEtcDirty, rebaselineEtcFields } from "@/lib/etc-dirty-tracker";
import { useAutosave } from "@/components/useAutosave";
import { SaveStatusChip } from "@/components/SaveStatusChip";

// Autosave for the Monthly ETC grid's New ETC cells.
//
// ── Only once the gate is already open ──────────────────────────────────────
// `unlocked` is isEtcEditUnlocked() from the server — the session cookie the
// manual Save sets after the password is entered once. Autosave never opens
// that gate and never carries a password: until someone has clicked Save once
// this session, nothing here writes.
//
// That is deliberate and it is the whole reason the old Parts Cost blur-save
// was removed (see PartsCostNewEtcCell) — it persisted on blur and skipped the
// password entirely, which made the gate decorative for one column. Autosave
// that bypasses a gate the Save button respects is a bug, not a feature.
//
// ── Drafts, not submissions ─────────────────────────────────────────────────
// This writes newEtcDraft, exactly as the Save button does. It never submits or
// locks a month: Submit ETC stays a deliberate, separately-confirmed act.
export function EtcAutosave({ formId, month, unlocked, locked }: { formId: string; month: string; unlocked: boolean; locked: boolean }) {
  const formRef = useRef<HTMLFormElement | null>(null);
  // The toolbar sits OUTSIDE this form (the grid form opens further down the
  // page), so it is reached by id — the same way SaveEtcDraftsButton does it.
  useEffect(() => {
    const el = document.getElementById(formId);
    formRef.current = el instanceof HTMLFormElement ? el : null;
  }, [formId]);

  const enabled = unlocked && !locked;

  const { status, schedule, retry } = useAutosave({
    enabled,
    // The value-based tracker, so a cell typed and put back the way it was
    // doesn't trigger a write.
    hasChanges: () => isEtcDirty(),
    save: async () => {
      const form = formRef.current;
      if (!form) return false;
      const fd = new FormData(form);
      const result = await saveAllNewEtcDrafts(month, fd);
      // Re-baseline from exactly what was posted, so the next edit is compared
      // against the saved values rather than what the page first loaded with.
      if (result.ok) rebaselineEtcFields(fd);
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
      if (t instanceof HTMLInputElement && (t.name.startsWith("newEtcOverride__") || t.name.startsWith("newEtcCreate__"))) schedule();
    };
    form.addEventListener("input", onEdit);
    return () => form.removeEventListener("input", onEdit);
  }, [enabled, schedule]);

  if (!enabled) return null;
  return <SaveStatusChip status={status} onRetry={retry} />;
}
