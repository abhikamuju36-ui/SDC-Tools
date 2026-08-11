import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logAuditFor } from "@/lib/audit";
import { verifySchedulerSsoToken, consumeSchedulerSsoNonce } from "@/lib/scheduler-sso";
import { currentTokenVersion } from "@/lib/token-revocation";

// Email/password authentication. Accounts are created via the sign-up form
// (see src/app/login/actions.ts) or the seed script; passwords are stored as
// bcrypt hashes and never in plaintext.
export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Required when self-hosting behind a hostname like server-app1 (NextAuth
  // otherwise only trusts hosts it can infer on known platforms).
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = (credentials?.email as string | undefined)?.trim().toLowerCase();
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: String(user.id), email: user.email, name: user.name, role: user.role };
      },
    }),
    // SSO hand-off FROM the Scheduler — the mirror image of the assertion
    // this app already mints for links going the other way (see
    // scheduler-sso.ts). An explicit `id` is required: Credentials()
    // defaults every instance to id:"credentials", so without this override
    // the second provider silently collides with the first and is never
    // reachable. Consumed by src/app/api/auth/sso/route.ts, never by the
    // login form — there is no UI for this provider.
    //
    // Same rule the Scheduler's own /api/auth/sso already follows: an
    // assertion says who someone is, not that they may use this app —
    // no upsert, no auto-provisioned account. An email with no Reports
    // user falls through to `null`, which NextAuth treats exactly like a
    // wrong password (rejected sign-in), never a broken link.
    Credentials({
      id: "scheduler-sso",
      credentials: {
        token: { label: "Token", type: "text" },
      },
      authorize: async (credentials) => {
        const token = credentials?.token as string | undefined;
        if (!token) return null;

        const verified = verifySchedulerSsoToken(token);
        if (!verified) return null;
        // Single-use, checked AFTER signature/expiry so a malformed or
        // already-expired token can't burn a legitimate nonce slot.
        if (!consumeSchedulerSsoNonce(verified.nonce)) return null;

        const user = await prisma.user.findUnique({ where: { email: verified.email } });
        if (!user) return null;

        return { id: String(user.id), email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user, account }) => {
      if (user) {
        // Fresh sign-in — pin the CURRENT version into the token. Read
        // fresh rather than trusting a value off `user` (neither provider's
        // `authorize()` returns one), which also means a version bumped
        // between "authorize() approved this sign-in" and "the jwt callback
        // ran" is still honoured correctly rather than baked in stale.
        token.role = (user as { role: string }).role;
        token.tokenVersion = (await currentTokenVersion(Number(user.id))) ?? 0;
        const viaSso = account?.provider === "scheduler-sso";
        await logAuditFor(Number(user.id), user.email ?? null, {
          action: "auth.signIn",
          entityType: "User",
          entityId: user.id,
          summary: viaSso ? `${user.email} signed in (via Scheduler SSO)` : `${user.email} signed in`,
        });
      } else if (token.sub) {
        // Existing session, re-checked on every request (this callback runs
        // whenever the session is read, not only at sign-in — see
        // token-revocation.ts). If a logout (here or on the Scheduler) or an
        // admin action bumped the version since this JWT was issued, the
        // value pinned above is stale — returning `null` is how a NextAuth
        // JWT session is invalidated server-side; the next page load bounces
        // to /login exactly as if there were no session at all.
        //
        // A token signed BEFORE this feature existed carries no
        // `tokenVersion` claim at all (`undefined`, not `0`) — treated as 0
        // here, the same tolerant reading the Scheduler's own check already
        // uses (`req.authUser.token_version || 0`), so deploying this does
        // NOT force-log-out every already-signed-in person for free; only an
        // ACTUAL revoke (which starts everyone else, and itself, at 0) does.
        const current = await currentTokenVersion(Number(token.sub));
        const tokenVersion = typeof token.tokenVersion === "number" ? token.tokenVersion : 0;
        if (current === null || current !== tokenVersion) return null;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
    authorized: async ({ auth }) => !!auth?.user,
  },
});
