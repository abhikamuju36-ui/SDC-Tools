# packages/

Reserved for code genuinely shared across more than one SDC app — not a dumping ground for app-specific logic. Nothing lives here yet.

## Known candidate: `sdcSessionAuth.js`

The SDC Tools centralized-login cookie verifier (`sdc_session`, minted by SDC Scheduler's `routes/ssoCentral.js`) is currently duplicated **verbatim** across four apps:

- `apps/assemblies/server/sdcSessionAuth.js`
- `apps/build-readiness/server/...` (same pattern)
- `apps/state-logic/...`
- `apps/calendar/server/...`

It's a real extraction candidate — same file, four copies, one shared secret (`SDC_SESSION_SECRET`) read from each app's own `.env`. It was deliberately **not** extracted as part of the 2026-08 restructuring: the SSO feature is currently dormant everywhere (`SDC_SSO_ENABLED` defaults off in every app), and touching four live production apps' auth-verification code at the same time as moving their folders was judged unnecessary risk for a purely structural cleanup. Do this as its own small, low-risk follow-up once someone's ready to turn SSO on for real — extract to `packages/shared-auth/`, update each app's import, keep the verification logic byte-for-byt identical.

## Adding something else here later

Before adding a new subfolder, confirm the code is actually imported by 2+ apps today (not "might be reused someday"). Candidates worth watching for, per the original restructuring brief, if they ever materialize: shared SDC branding/theming, common UI primitives, shared employee/project TypeScript types, shared formatting helpers. None of these exist as real duplicated code yet as of this writing — don't create empty scaffolding for them ahead of need.
