import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

// Inbound half of the Scheduler ↔ Reports SSO hand-off — the mirror of
// scheduler-sso.ts's outbound mint, which every existing Reports→Scheduler
// link already uses. A Scheduler-authored link lands HERE, never on the
// final destination directly: proxy.ts's session gate runs before any other
// route's own code does, so a token bolted onto e.g.
// "/job-hours?...&sso=..." would be silently dropped at the login redirect
// before anything could read it. This route is exempt from that gate for
// free — proxy.ts's matcher already excludes the whole `api/auth` prefix.
//
// Calls the SERVER-exported `signIn` from lib/auth (not next-auth/react's
// client one) with a synthetic in-process request, so verifying the
// assertion and establishing the real session cookie happens in one hop —
// no rendered landing page, no client-side round trip.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const next = req.nextUrl.searchParams.get("next") || "/";
  if (!token) return NextResponse.redirect(new URL("/login", req.url));

  try {
    // `next` reaches NextAuth's own `redirectTo`, which its default redirect
    // callback already collapses any off-origin value back to this app's own
    // origin — an open redirect via `next=` isn't possible without this
    // route adding anything itself.
    const url = await signIn("scheduler-sso" as Parameters<typeof signIn>[0], {
      token,
      redirectTo: next,
      redirect: false,
    });
    return NextResponse.redirect(new URL(url as string, req.url));
  } catch (e) {
    // Bad signature, expired, already-used, or no Reports account for that
    // email — every one of those collapses to authorize() returning null,
    // which NextAuth reports uniformly as an AuthError. Whatever the exact
    // cause, this must degrade to the normal login form, never a broken or
    // blank page.
    if (e instanceof AuthError) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    throw e;
  }
}
