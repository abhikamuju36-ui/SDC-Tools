import { auth, signOut } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { getSchedulerBaseUrl } from "@/lib/scheduler-link";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  const role = (session?.user as { role?: string } | undefined)?.role;

  return (
    // The Scheduler's base URL lives in server-only env (SCHEDULER_BASE_URL),
    // so it has to be handed to the client sidebar as a prop rather than read
    // there. `/?view=projects` lands on the Scheduler's Projects page.
    <AppShell
      userEmail={session?.user?.email}
      role={role}
      signOutAction={handleSignOut}
      schedulerProjectsUrl={`${getSchedulerBaseUrl()}/?view=projects`}
    >
      {children}
    </AppShell>
  );
}
