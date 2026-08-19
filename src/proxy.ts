import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { permissionForPath, safeFallbackPath } from "@/lib/route-permissions";

// Passing auth() a handler function (rather than re-exporting it bare, as
// this used to) makes next-auth skip its own `authorized` callback entirely
// — see the comment on auth.ts's callbacks object. That means the "must be
// signed in" check that callback used to provide is now THIS function's job
// too, not just the new permission check below; both live here so there is
// one place, not two, deciding what a given request may reach.
export const proxy = auth((req) => {
  if (!req.auth?.user) {
    const signInUrl = new URL("/login", req.url);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.href);
    return NextResponse.redirect(signInUrl);
  }

  // /cash-flow checked separately, by role rather than through
  // permissionForPath/hasPermission() below — it's ELT-only by explicit
  // request and deliberately NOT a togglable Permission (see
  // cash-flow-access.ts's requireEltOnly(), the same rule this mirrors), so a
  // Role Permissions matrix change can never widen it. Page/action-level
  // enforcement already covered this; this only adds the same defense-in-depth
  // every other route gets against a typed-in URL.
  if (req.nextUrl.pathname.startsWith("/cash-flow") && req.auth.user.role !== "ELT") {
    return NextResponse.redirect(new URL(safeFallbackPath(req.auth.user.role), req.url));
  }

  // Defense-in-depth against a typed-in URL — NOT the only enforcement point.
  // A Server Action's route can fall outside this matcher entirely, so every
  // mutating action re-checks with assertActionPermission() regardless of
  // what happens here (see require-permission.ts).
  //
  // The redirect target is NEVER a hardcoded "/" — dashboard:view is
  // MANAGER-and-up, so an ALL role denied anywhere would get sent to "/" and
  // immediately refused "/" too: an infinite loop (found live 2026-08-18,
  // ERR_TOO_MANY_REDIRECTS from outside the office LAN). safeFallbackPath
  // always lands on a route the caller's own role can actually see.
  const permission = permissionForPath(req.nextUrl.pathname);
  if (permission && !hasPermission(req.auth.user.role, permission)) {
    return NextResponse.redirect(new URL(safeFallbackPath(req.auth.user.role), req.url));
  }
});

export const config = {
  // api/integration is exempt from the browser NextAuth session: those routes
  // are server-to-server (called by SDC_Scheduler) and enforce their own
  // SCHEDULER_SHARED_TOKEN bearer guard, which fails closed when unset.
  matcher: ["/((?!login|api/auth|api/integration|api/health|_next/static|_next/image|favicon.ico|brand/).*)"],
};
