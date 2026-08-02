"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { syncEtcHistory, type SyncHistoryResult } from "@/lib/etc-actions";
import { useToast } from "@/components/ui/Toast";

const INITIAL_STATE: SyncHistoryResult = { monthsRefreshed: 0, reconciledMonths: [], entriesReconciled: 0, poolEntriesReconciled: 0 };

// Sync History used to only report reconciliation in the audit log — an admin
// had to go looking for it. useActionState surfaces the same result returned by
// syncEtcHistory as a toast (via the shared toast system), same true->false
// pending transition trick as RunReportButton.
export function SyncHistoryButton({ className }: { className?: string }) {
  const [state, formAction, pending] = useActionState(syncEtcHistory, INITIAL_STATE);
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) {
      const fieldsReconciled = state.entriesReconciled + state.poolEntriesReconciled;
      toast(
        state.reconciledMonths.length > 0
          ? `Sync complete — reconciled ${fieldsReconciled} display field(s) for ${state.reconciledMonths.join(", ")} (submitted decisions/dollars unchanged).`
          : `Sync complete — ${state.monthsRefreshed} historical month(s) refreshed from Power BI.`,
      );
    }
    wasPending.current = pending;
  }, [pending, state, toast]);

  // Password-gated in the form itself (checked server-side in syncEtcHistory).
  // This used to be admin-only, which hid the button and gated nothing — the
  // action was reachable by anyone signed in. It re-pulls every historical
  // month, so it earns a deliberate keystroke.
  return (
    <form action={formAction} className="space-y-1.5">
      <input
        type="password"
        name="syncHistoryPassword"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        aria-label="Sync History password"
        className="w-full rounded-md border border-sdc-border px-2 py-1 text-xs outline-none focus:border-sdc-blue"
      />
      <button
        type="submit"
        className={className}
        disabled={pending || password.length === 0}
        title="Re-pull all past months from Power BI's ETC Historical measures. Months submitted in this app are never overwritten — only their display-only fields (Hours Worked/Prior ETC) self-heal if Power BI's archive changes after the fact."
      >
        {pending ? "Syncing…" : "Sync History"}
      </button>
    </form>
  );
}
