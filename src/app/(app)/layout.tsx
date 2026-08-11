import { cookies } from "next/headers";
import { auth, signOut } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { COLLAPSED_COOKIE, WIDTH_COOKIE, parseSidebarPrefs } from "@/lib/sidebar-prefs";
import { LiveRefresh } from "@/components/LiveRefresh";
import { RealtimeProvider } from "@/components/RealtimeProvider";
import { InteractionMetrics } from "@/components/InteractionMetrics";
import { getSchedulerBaseUrl, revokeSchedulerSession } from "@/lib/scheduler-link";
import { withSchedulerSso } from "@/lib/scheduler-sso";

// NOTE for anyone tempted to cache this layout or lift the auth() call out of it:
// `await auth()` reads cookies, and that is what makes EVERY page under (app)
// dynamically rendered. Four route files contain no request-time API of their own
// and are dynamic purely by inheritance from here. Caching this would freeze them
// for every user at once — which is the shape of the bug fixed on 2026-08-04.
export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  // ── The sidebar's state, resolved SERVER-side (§46.14) ──────────────────────
  //
  // It used to live in localStorage, which the server cannot see — so a collapsed
  // sidebar was rendered EXPANDED (measured: `<aside style="width:276px">` with every
  // label, the search field and the version string) and snapped to the 60px rail after
  // hydration. One flash per page load, on every route.
  //
  // Reading it here costs nothing that isn't already being paid: `auth()` above reads
  // cookies, which is what makes every route under this layout dynamic. See
  // lib/sidebar-prefs.ts for why this preference — and only this one — is a cookie.
  const jar = await cookies();
  const sidebar = parseSidebarPrefs(jar.get(COLLAPSED_COOKIE)?.value, jar.get(WIDTH_COOKIE)?.value);

  async function handleSignOut() {
    "use server";
    // Invalidate any Scheduler session for the same person too — read
    // BEFORE signOut() clears this app's own session, since there'd be
    // nothing left to read afterward. Best-effort; see revokeSchedulerSession
    // for why a slow/unreachable Scheduler can't hang or block this.
    await revokeSchedulerSession(session?.user?.email);
    await signOut({ redirectTo: "/login" });
  }


  return (
    // The Scheduler's base URL lives in server-only env (SCHEDULER_BASE_URL),
    // so it has to be handed to the client sidebar as a prop rather than read
    // there. `/?view=projects` lands on the Scheduler's Projects page.
    <AppShell
      userEmail={session?.user?.email}
      signOutAction={handleSignOut}
      // What the server rendered with. The client store reads the same two cookies, so
      // the value React hydrates with is the value already on screen.
      sidebar={sidebar}
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
      {/* The realtime layer, also once for the whole app: one SSE connection per
          tab carrying presence ("who is editing this cell") and change events
          ("what did somebody just save"). RealtimeProvider renders nothing — it
          owns the connection. ChangeNotifications (the change-event banner) is
          no longer mounted here: since 2026-08-10 it renders from inside
          AppShell's ToastProvider, which is the one place notifications share a
          single fixed stack — see the note in ui/Toast.tsx. */}
      <RealtimeProvider />
      {/* Interaction timing (§38.14), once for the whole app so every route is measured
          the same way. Renders nothing, sends nothing, and stays dormant in production
          until somebody asks for it with ?perf=1 — see the header note. */}
      <InteractionMetrics />
      {children}
    </AppShell>
  );
}
