import { isAuditLogUnlocked, hadWrongAuditLogPassword, unlockAuditLog } from "@/lib/audit-log-gate";
import { PasswordGate } from "@/components/PasswordGate";

export default async function AuditLogLayout({ children }: { children: React.ReactNode }) {
  const [unlocked, wrongPassword] = await Promise.all([isAuditLogUnlocked(), hadWrongAuditLogPassword()]);

  if (!unlocked) {
    return (
      <PasswordGate
        action={unlockAuditLog}
        title="Audit Log is protected"
        hint="Enter the password to view this tab."
        wrongPassword={wrongPassword}
      />
    );
  }

  return <>{children}</>;
}
