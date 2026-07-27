"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useToast } from "@/components/ui/Toast";
import { BUTTON_PRIMARY } from "@/components/ui/classnames";

// The Projects grid's "Save Quoted Hours" submit — previously a plain button
// with no feedback on a large form. Shows a pending state (disabled + "Saving…")
// and a success toast. (A validation error still surfaces via the route's error
// boundary; inline error toasts would need the action to return state.)
export function SaveQuotedHoursButton() {
  const { pending } = useFormStatus();
  const { toast } = useToast();
  const wasPending = useRef(false);

  useEffect(() => {
    // pending true -> false without an unmount means the action resolved (a
    // thrown validation error would have swapped in the error boundary instead).
    if (wasPending.current && !pending) toast("Quoted hours saved.");
    wasPending.current = pending;
  }, [pending, toast]);

  return (
    <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
      {pending ? "Saving…" : "Save Quoted Hours"}
    </button>
  );
}
