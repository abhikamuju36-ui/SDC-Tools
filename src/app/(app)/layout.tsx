import { auth, signOut } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { getSchedulerBaseUrl } from "@/lib/scheduler-link";
import { withSchedulerSso } from "@/lib/scheduler-sso";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }


  return (
    // The Scheduler's base URL lives in server-only env (SCHEDULER_BASE_URL),
    // so it has to be handed to the client sidebar as a prop rather than read
    // there. `/?view=projects` lands on the Scheduler's Projects page.
    <AppShell
      userEmail={session?.user?.email}
      signOutAction={handleSignOut}
      // Carries a 60-second signed assertion of who is signed in here, so the
      // Scheduler can start its own session instead of showing a login modal to
      // someone the app already authenticated. No secret configured, or no
      // session: the link is unchanged and the Scheduler asks as it does today.
      schedulerProjectsUrl={withSchedulerSso(`${getSchedulerBaseUrl()}/?view=projects`, session?.user?.email)}
    >
      {children}
    </AppShell>
  );
}
