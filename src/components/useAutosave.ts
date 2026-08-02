"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUTOSAVE_DELAY_MS, needsFollowUpSave, shouldAutosave, type AutosaveStatus } from "@/lib/autosave";

// Debounce + coalesce + status for the two grids' autosave. The RULES live in
// lib/autosave.ts (pure, tested); this is the timer and the React state around
// them.
//
// `save` must resolve true on success. It is called at most once at a time —
// edits made mid-flight schedule exactly one follow-up rather than stacking.
type Deps = {
  enabled: boolean;
  save: () => Promise<boolean>;
  hasChanges: () => boolean;
  hasUnsavedNewRows: () => boolean;
};

export function useAutosave({
  enabled,
  save,
  hasChanges,
  hasUnsavedNewRows = () => false,
  delayMs = AUTOSAVE_DELAY_MS,
}: {
  enabled: boolean;
  save: () => Promise<boolean>;
  hasChanges: () => boolean;
  hasUnsavedNewRows?: () => boolean;
  delayMs?: number;
}) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const changedDuringSave = useRef(false);

  // One "latest props" ref, written in an effect rather than during render
  // (the repo lints ref writes in render, and rightly — a render that is
  // thrown away would still have mutated it). The consumers install a single
  // delegated DOM listener that lives for the life of the page, so it must not
  // close over the first render's props.
  const latest = useRef<Deps>({ enabled, save, hasChanges, hasUnsavedNewRows });
  useEffect(() => {
    latest.current = { enabled, save, hasChanges, hasUnsavedNewRows };
  });

  // A loop, not recursion: the follow-up save for edits made mid-flight is
  // just "go round again", and calling run() from inside itself would be a
  // self-referencing useCallback (which this repo's lint rejects, and which
  // captures a stale binding anyway).
  const run = useCallback(async () => {
    for (;;) {
      const { enabled: on, save: doSave, hasChanges: dirty, hasUnsavedNewRows: newRows } = latest.current;
      if (!shouldAutosave({ enabled: on, hasChanges: dirty(), inFlight: inFlight.current, hasUnsavedNewRows: newRows() })) {
        // Not saving, but there IS something unsaved — say so rather than
        // sitting on a stale "All changes saved".
        if (on && dirty()) setStatus("pending");
        return;
      }

      inFlight.current = true;
      changedDuringSave.current = false;
      setStatus("saving");
      let ok = false;
      try {
        ok = await doSave();
      } catch {
        ok = false;
      }
      inFlight.current = false;
      setStatus(ok ? "saved" : "error");

      // Terminates: the next pass re-runs shouldAutosave, which needs
      // hasChanges() to still be true — and a successful save is what makes it
      // false. A failed save exits here rather than retrying (see
      // needsFollowUpSave).
      if (!needsFollowUpSave({ changedDuringSave: changedDuringSave.current, lastSaveOk: ok })) return;
    }
  }, []);

  // Call on every edit.
  const schedule = useCallback(() => {
    if (!latest.current.enabled) return;
    if (inFlight.current) {
      // Remember, so run() fires again once the current save lands. Without
      // this the edit would wait for the next keystroke that never comes.
      changedDuringSave.current = true;
      return;
    }
    setStatus("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), delayMs);
  }, [run, delayMs]);

  // Save NOW, skipping the debounce — used when the tab is being hidden, where
  // waiting out the timer would lose the edit. Also backs the chip's Retry.
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    void run();
  }, [run]);

  useEffect(() => {
    const t = timer;
    return () => {
      if (t.current) clearTimeout(t.current);
    };
  }, []);

  // A backgrounded or closing tab is the one case where the debounce is
  // actively harmful. visibilitychange fires reliably on tab switches and on
  // mobile, where beforeunload does not.
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [enabled, flush]);

  return { status, schedule, flush, retry: flush };
}
