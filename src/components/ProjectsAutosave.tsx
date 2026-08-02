"use client";

import { useEffect, useRef } from "react";
import { useProjectsEditMode } from "@/components/ProjectsEditMode";
import { useSaveState } from "@/components/QuotedSaveForm";
import { useAutosave } from "@/components/useAutosave";
import { SaveStatusChip } from "@/components/SaveStatusChip";
import { countChanged } from "@/lib/dirty-form";

// Autosave for the Projects grid.
//
// Rendered inside ProjectsEditModeProvider (it needs `editing`) and inside the
// grid's <form> (it drives the form's own submit path). Both are true of the
// toolbar, which is where it lives.
//
// It does NOT reimplement saving. QuotedSaveForm's onSubmit already serialises
// only the CHANGED controls (dirty-form.ts) and dispatches the action, so
// autosave is just a debounced requestSubmit() — the payload, the validation
// and the result banner are the same ones the Save button gets. Reimplementing
// any of that would be a second save path to keep in step with the first.
//
// ONE delegated listener on the form, not one per control: this grid renders
// ~1,100 inputs, and attaching to each is both slow and impossible to keep
// attached as rows re-render under filters.
export function ProjectsAutosave() {
  const { editing } = useProjectsEditMode();
  const { pending, result } = useSaveState();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const { status, schedule, retry } = useAutosave({
    enabled: editing,
    hasChanges: () => {
      const form = formRef.current;
      return !!form && countChanged(form) > 0;
    },
    // "+ Add Project" rows are validated as a batch — one blank Job Id rejects
    // the whole submission — so autosaving while someone types one would fail
    // on every keystroke. They stay on the manual Save button.
    hasUnsavedNewRows: () => !!formRef.current?.querySelector("[name^='newRow__']"),
    save: async () => {
      const form = formRef.current;
      if (!form) return false;
      form.requestSubmit();
      // requestSubmit() is fire-and-forget; the action's outcome arrives via
      // useActionState on QuotedSaveForm. Resolving true here means "submitted",
      // and the effect below corrects the chip to `error` if the result says
      // otherwise — which keeps this hook from having to know the action's shape.
      return true;
    },
  });

  // Find the enclosing form once and attach the delegated listeners.
  useEffect(() => {
    const form = anchorRef.current?.closest("form");
    formRef.current = form ?? null;
    if (!form) return;
    // `input` covers typing; `change` covers <select> and date pickers, which
    // fire input inconsistently across browsers. Both are captured at the form,
    // so rows added or re-rendered later are covered without re-binding.
    const onEdit = () => schedule();
    form.addEventListener("input", onEdit);
    form.addEventListener("change", onEdit);
    return () => {
      form.removeEventListener("input", onEdit);
      form.removeEventListener("change", onEdit);
    };
  }, [schedule]);

  // The hook only knows the submit was DISPATCHED — the action's verdict comes
  // back through useActionState on the form. So the action wins: a rejected
  // save must not leave a green "All changes saved" on screen, which is the
  // single most dangerous thing this chip could say.
  //
  // Order matters. In flight beats everything; then a failed result; then the
  // hook's own state (which is what reports "Unsaved changes" while the
  // debounce is still counting down).
  const shown = pending ? "saving" : result && !result.ok ? "error" : status;

  return (
    <span ref={anchorRef} className="flex items-center">
      <SaveStatusChip status={shown} onRetry={retry} />
    </span>
  );
}
