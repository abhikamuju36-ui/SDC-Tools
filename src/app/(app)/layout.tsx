import { auth, signOut } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getSchedulerBaseUrl } from "@/lib/scheduler-link";
import { withSchedulerSso } from "@/lib/scheduler-sso";

// NOTE for anyone tempted to cache this layout or lift the auth() call out of it:
// `await auth()` reads cookies, and that is what makes EVERY page under (app)
// dynamically rendered. Four route files contain no request-time API of their own
// and are dynamic purely by inheritance from here. Caching this would freeze them
// for every user at once — which is the shape of the bug fixed on 2026-08-04.
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
      {/* Mounted once for the whole app, so every tab — Projects, Monthly ETC,
          Employees, Job Hours, the dashboard, a job page — picks up what other
          people have saved instead of staying the snapshot it loaded with. See
          LiveRefresh for why revalidatePath was not the answer. */}
      <LiveRefresh />
      {children}
    </AppShell>
  );
}
