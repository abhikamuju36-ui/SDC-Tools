"use client";

import { useTransition } from "react";
import type { AppRole } from "@/lib/permissions";

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "MANAGER", label: "Managers" },
  { value: "SALES", label: "Sales" },
  { value: "ELT", label: "ELT" },
];

// A signed-in ELT user can't change their OWN role here — the guard against
// the whole tier locking itself out of the one screen that assigns it. Ask
// another ELT user (or, if there truly is only one, a direct DB update).
export function UserRoleSelect({
  userId,
  role,
  isSelf,
  action,
}: {
  userId: number;
  role: AppRole;
  isSelf: boolean;
  action: (userId: number, role: AppRole) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  if (isSelf) {
    return (
      <span className="text-sdc-muted" title="You can't change your own role here — ask another ELT user.">
        {ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role} (you)
      </span>
    );
  }

  return (
    <select
      defaultValue={role}
      disabled={pending}
      onChange={(e) => startTransition(() => action(userId, e.target.value as AppRole))}
      className="rounded-md border border-sdc-border px-2 py-1 text-sm disabled:opacity-60"
    >
      {ROLE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
