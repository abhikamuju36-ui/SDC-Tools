"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useToast } from "@/components/ui/Toast";

// Server actions give no built-in "it finished" signal — useFormStatus's
// `pending` flips back to false once the action resolves and the page
// revalidates, so a true->false transition is our completion event. Must be
// rendered as a child of the <form action={...}> it's reporting on. Feedback
// now goes through the shared toast system (was a bespoke fixed div).
export function RunReportButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  const { toast } = useToast();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) toast("Report completed — data refreshed from the source systems.");
    wasPending.current = pending;
  }, [pending, toast]);

  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? "Refreshing…" : children}
    </button>
  );
}
