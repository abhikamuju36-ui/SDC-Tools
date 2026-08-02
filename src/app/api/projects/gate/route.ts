import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyProjectsPassword, setProjectsUnlocked, clearProjectsUnlocked } from "@/lib/projects-gate";

// Lock/unlock for the Projects grid's password gate.
//
// A route handler rather than a server action, deliberately: a server action
// makes Next re-render the calling route, and /quoted costs nine sequential
// database round trips to render (one of them to the Scheduler's MySQL server).
// Unlocking was taking seconds to swap a password box for a toggle button. See
// the note in lib/projects-gate.ts.
//
// This sits behind the app's normal session check — proxy.ts only exempts
// api/auth, api/integration and api/health — but auth() is re-checked here
// anyway rather than trusted from the matcher, since this route hands out an
// unlock cookie.

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  let body: { action?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
  }

  if (body.action === "lock") {
    await clearProjectsUnlocked();
    return NextResponse.json({ ok: true });
  }

  if (body.action !== "unlock") {
    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }

  // A wrong password is expected user input, not an error condition — 200 with
  // ok:false, so the caller shows "Wrong password" rather than a failed-request
  // message. The password itself is compared server-side (constant-time) and
  // never reaches the client bundle.
  if (!(await verifyProjectsPassword(String(body.password ?? "")))) {
    return NextResponse.json({ ok: false });
  }

  await setProjectsUnlocked();
  return NextResponse.json({ ok: true });
}
