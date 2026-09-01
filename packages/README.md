# packages/

Reserved for code genuinely shared across more than one SDC app — not a dumping ground for app-specific logic.

## `shared-auth/`

The SDC Tools centralized-login cookie verifier (`sdc_session`, minted by SDC Scheduler's `routes/ssoCentral.js`). Canonical source for `requireSdcSession`/`verifySdcSession`, imported as `@sdc/shared-auth` by Assemblies Library, Build Readiness Report, and State Logic Builder (all three via the root npm workspace) and Calendar (via a `file:` dependency, since it isn't a workspace member). Previously duplicated verbatim across all four apps; Calendar's `server/middleware/requireAuth.js` still keeps its own bespoke wrapper (`resolveShellUser`, legacy bearer fallback, etc.) around the shared `verifySdcSession` import, since only that core piece was ever actually duplicated there.

## `design-system/`

Shared design tokens and CSS primitives, consumed via relative-path `@import`/static file serving (not npm resolution — see its own files for the pattern).

## Adding something else here later

Before adding a new subfolder, confirm the code is actually imported by 2+ apps today (not "might be reused someday"). Candidates worth watching for, per the original restructuring brief, if they ever materialize: shared SDC branding/theming, common UI primitives, shared employee/project TypeScript types, shared formatting helpers. None of these exist as real duplicated code yet as of this writing — don't create empty scaffolding for them ahead of need.
