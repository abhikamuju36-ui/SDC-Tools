import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { safeFallbackPath } from "@/lib/route-permissions";
import type { Session } from "next-auth";

// Cash Flow Forecast is ELT-only, by explicit request — not a togglable
// Permission like everything else in permissions.ts/PERMISSION_CATALOG (a
// Role Permissions matrix row would let an ELT admin accidentally hand it to
// MANAGER/SALES, which is exactly what "exclusive to ELT role" rules out).
// This checks the role directly rather than going through hasPermission(),
// so there is no toggle anywhere in the app that can widen access to this
// page — changing that would need a code change here, not a checkbox.

export async function requireEltOnly(): Promise<Session> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ELT") redirect(safeFallbackPath(session.user.role));
  return session;
}

export async function assertEltOnlyAction(): Promise<Session> {
  const session = await auth();
  if (!session?.user) throw new Error("You need to be signed in to do that.");
  if (session.user.role !== "ELT") throw new Error("Cash Flow Forecast is restricted to ELT.");
  return session;
}
