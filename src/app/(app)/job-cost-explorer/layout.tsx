import { isJobCostExplorerUnlocked, hadWrongJobCostExplorerPassword, unlockJobCostExplorer } from "@/lib/job-cost-explorer-gate";
import { PasswordGate } from "@/components/PasswordGate";

export default async function JobCostExplorerLayout({ children }: { children: React.ReactNode }) {
  const [unlocked, wrongPassword] = await Promise.all([isJobCostExplorerUnlocked(), hadWrongJobCostExplorerPassword()]);

  if (!unlocked) {
    return (
      <PasswordGate
        action={unlockJobCostExplorer}
        title="Job Cost Explorer is protected"
        hint="Enter the password to view this tab."
        wrongPassword={wrongPassword}
      />
    );
  }

  return <>{children}</>;
}
