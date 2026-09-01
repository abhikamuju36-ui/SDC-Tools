# packages/

Reserved for code genuinely shared across more than one SDC app — not a dumping ground for app-specific logic. Nothing lives here yet.

## `sdcSessionAuth.js` — extraction in progress

The SDC Tools centralized-login cookie verifier (`sdc_session`, minted by SDC Scheduler's `routes/ssoCentral.js`) was previously duplicated **verbatim** across four apps. It's now being extracted to `packages/shared-auth/` (`@sdc/shared-auth`, registered as a root npm workspace member), staged across three PRs to keep the diff and risk contained:

- **Done** — Build Readiness (`apps/build-readiness/server/index.js`) imports `@sdc/shared-auth`; its local `sdcSessionAuth.js` copy is deleted.
- **Not yet migrated** — `apps/assemblies/server/sdcSessionAuth.js` and `apps/state-logic/sdcSessionAuth.js` still hold the old duplicated copy (pending a PR that also verifies electron-builder correctly packages the new workspace dependency for these two Electron-shipped apps). `apps/calendar/server/middleware/requireAuth.js` still holds its own inline copy of just the `verifySdcSession` core (pending a PR that swaps that one function for the shared import, while keeping the rest of that file — `resolveShellUser`, the legacy bearer fallback, etc. — local, since only the verify core is actually duplicated there).

Once all three apps are migrated, this section should be replaced with a one-line note pointing at `packages/shared-auth/` as the canonical source, same as `packages/design-system/`.

## Adding something else here later

Before adding a new subfolder, confirm the code is actually imported by 2+ apps today (not "might be reused someday"). Candidates worth watching for, per the original restructuring brief, if they ever materialize: shared SDC branding/theming, common UI primitives, shared employee/project TypeScript types, shared formatting helpers. None of these exist as real duplicated code yet as of this writing — don't create empty scaffolding for them ahead of need.
