# Developing SDC Tools together

A working plan for two developers (Abhi and Dan) building all seven apps out of one
repo — **`abhikamuju36-ui/SDC-Tools`** — on a box that is also production.

- **Written:** 2026-09-03
- **Status:** **Phases 0-3 are DONE** (2026-09-03). Phase 2's GitHub-side settings and
  Phase 4 are outstanding — see §10.
- **Scope:** repo layout, branch workflow, and the deploy plumbing that has to change
  with them.

---

## 1. The problem is not the repo layout

Consolidating repos is the easy half and the least urgent. The thing that will actually
bite is this:

> **The production tree is also the working tree, and three auto-updaters rewrite it on a
> timer.**

`D:\AI Projects\Centrailized library` is simultaneously the checkout people edit, the
directory PM2 runs seven apps from, and the target of updaters that run every 2–5
minutes:

| Updater | Every | What it does to the tree |
|---|---|---|
| `scripts/sdc-main-updater.js` | 5 min | Fast-forward only (guarded), selective `git checkout` of changed files, `fs.unlinkSync` for files deleted upstream |
| `SDC_Scheduler/scripts/server-auto-update.js` | **2 min** | **`git reset --hard origin/<branch>`** |
| `apps/state-logic/scripts/server-auto-update.js` | 5 min | Pull, `npm install`, `npm run build`, `pm2 restart` |

With one developer who knows where the traps are, that is survivable. With **two people
pushing to a shared repo it is a data-loss machine**: Dan merges a PR, the updater sees
the remote ahead, and the tree Abhi is mid-edit in gets fast-forwarded — or hard-reset, in
the Scheduler's case — underneath him.

So the order below is deliberate. **Phases 0–2 make collaboration safe. Phase 3 onward is
the repo consolidation**, which is what was asked for but is not what makes this work.

---

## 2. Phase 0 — Turn CI on (do this first; one line, no risk)

`.github/workflows/ci.yml` triggers on:

```yaml
on:
  push:
    branches: [main, develop, 'feature/**', 'fix/**']
  pull_request:
    branches: [main]
```

**This repo is on `master`.** There is no `main` and no `develop`. So:

- No push to `master` has ever run CI.
- No pull request has ever run CI, because none can target `main`.

Every job in that file — shell lint/build, the app test suites — has been dormant. That is
the single cheapest fix here and it matters most the moment two people start merging each
other's work.

```yaml
on:
  push:
    branches: [master, 'feat/**', 'fix/**']
  pull_request:
    branches: [master]
```

Then confirm a run appears on the Actions tab. **Do this before anything else in this
document**, so every later phase lands with tests actually gating it.

---

## 3. Phase 1 — Stop editing the production tree

This is the change that makes two-person development possible, and it is independent of
consolidation.

**The rule:** `D:\AI Projects\Centrailized library` stays on `master` and nobody edits it.
It is a deploy target. The updaters own it.

Each developer works in a **linked git worktree** on its own path:

```bash
git -C "D:/AI Projects/Centrailized library" worktree add "D:/AI Projects/sdc-abhi" -b feat/my-thing
```

`node_modules` is not checked out into a worktree — junction it rather than reinstalling:

```powershell
New-Item -ItemType Junction -Path "D:/AI Projects/sdc-abhi/node_modules" `
         -Target "D:/AI Projects/Centrailized library/node_modules"
```

`apps/assemblies` and `sdc-etc-planner` also need their own local `node_modules`
junctioned.

**One gotcha, found setting this up:** a fresh worktree fails `tsc` in the Reports app
with `Cannot find name 'RouteContext'`. Those are Next.js *generated* types under
`.next/types`, which `tsconfig.json` includes and which do not exist until something
has built. Run a build once in the worktree before trusting a typecheck:

```bash
cd "D:/AI Projects/sdc-abhi/sdc-etc-planner" && npx next build
```

**Why worktrees rather than a second clone:** they share one object store, so branches are
visible from both, and the prod tree can never be left on a feature branch by accident —
which is the specific failure that has destroyed work here before (see
`sdc-scheduler-prod-ops` notes: an updater found HEAD ahead of the remote and unlinked
files off disk).

**Per-app dev servers, so a worktree never fights production for a port:**

| App | Prod port | Dev command |
|---|---|---|
| Reports | 4006 | `npm run dev:verify` → 3021 (own `.next-verify`) |
| Assemblies | 4001 | `.claude/launch.json` → `ux-assemblies` (5199) |
| Others | 4002–4005 | pick a free port; never reuse the prod one |

---

## 4. Phase 2 — Branch and PR workflow

With CI live and worktrees in place:

1. **`master` is the deploy branch.** A merge to `master` is a deployment — the updater
   picks it up within 5 minutes. Nobody pushes to it directly.
2. **Branch per change**, `feat/…` or `fix/…`, so CI's path filters fire.
3. **PR into `master`**, CI green, one review from the other person.
4. **Squash-merge**, so `master` history is one commit per change and the updater's
   fast-forward is clean.

**On file ownership.** The old Scheduler convention (Dan owns `public/app.js`,
`styles.css`, `index.html`, `release-notes.js`, `phases.js`; Abhi owns `server.js`,
`db.js`, `lib/`, `routes/`, `scripts/`) existed because there was no review step — it was
how two people avoided editing the same file. With PRs it stops being a rule and becomes a
**review hint**: whoever owns the area reviews the PR. Keep it written down for that
reason, drop it as a restriction.

**Recommended branch protection on `master`:** require a PR, require CI to pass, and
disallow force-push. Force-push to `master` is the one action that can genuinely corrupt
the prod tree, because the updaters only ever fast-forward and would then be permanently
stuck.

---

## 5. Phase 3 — Bring Reports and PowerBI into SDC-Tools

Currently excluded by `.gitignore`, each its own repo:

| App | Its repo | `.gitignore` line |
|---|---|---|
| Reports (`sdc-etc-planner`) | `abhikamuju36-ui/sdc-sheets` | 15 |
| PowerBI (`SDC-PowerBI-DEV`) | `abhikamuju36-ui/SDC-PowerBI` | 10 |

### 5.1 Fix the updater plumbing FIRST

`sdc-main-updater.js` builds and restarts only what it knows about:

```js
const FRONTEND_BUILDS = [
  { prefix: 'apps/assemblies/',      name: 'Assemblies Library' },
  { prefix: 'apps/build-readiness/', name: 'Build Readiness' },
];
// …
'pm2 restart sdc-assemblies sdc-readiness sdc-calendar --update-env'
```

Neither list mentions `sdc-etc-planner`. **Track the Reports app without changing this and
every merge updates its source on the prod box while users keep getting the old `.next`
build — silently, indefinitely.** That is exactly the "silently stale bundle" failure the
updater's own comments say it was rewritten to avoid.

So, in one commit, before the app is tracked:

- add `{ prefix: 'sdc-etc-planner/', name: 'Reports' }` to `FRONTEND_BUILDS`
- add `sdc-etc-planner` to the `pm2 restart` line
- consider `PROTECTED` entries for anything that must survive a checkout (`.env` is
  already gitignored, so this is likely empty — verify rather than assume)

**Prisma is the sharp edge.** The Reports app has migrations, and `prisma generate` fails
with `EPERM` while the app is running because PM2 holds the query engine DLL. The updater
cannot run it mid-cycle. Two options, and this needs deciding before Phase 3 ships:

- **A.** The updater runs `prisma migrate deploy` but never `generate`, and a schema change
  requires a manual `pm2 stop → generate → start`. Simple, but a schema change silently
  half-deploys.
- **B.** The updater stops the app, runs `migrate deploy` + `generate`, builds, starts.
  Correct, but every Reports deploy becomes a brief outage.

**B is the honest choice** — a Next.js deploy restarts the app anyway.

### 5.2 Move without moving the directory

PM2 runs Reports with an absolute `cwd`:

```js
cwd: 'D:\\AI Projects\\Centrailized library\\sdc-etc-planner'
```

The usual `git subtree add` needs an empty target path, i.e. moving that directory aside —
**with users connected, that kills the app mid-request.** Use the subtree-merge recipe
instead, which never touches the working tree:

```bash
cd "D:/AI Projects/Centrailized library"
git remote add reports https://github.com/abhikamuju36-ui/sdc-sheets.git
git fetch reports main
git merge -s ours --no-commit --allow-unrelated-histories reports/main
git read-tree --prefix=sdc-etc-planner/ -u reports/main
# then drop .gitignore line 15, and commit
```

History is preserved and linked. Do the same for `SDC-PowerBI-DEV`, which is lower risk —
it is not a PM2 app.

Afterwards: delete the nested `sdc-etc-planner/.git` so there is one repo, and archive
`sdc-sheets` / `SDC-PowerBI` on GitHub rather than deleting them — they are the fallback if
this goes wrong.

### 5.3 Outstanding before this can start

There is a branch on `sdc-sheets` that has to land first:
**`feat/split-view-and-parts-projection`** (commit `90757fc`, 40 files — split view, the
Parts Cost projection rebuild, the ETC risk highlight). It is unverified in a browser.
Either merge it to `sdc-sheets/main` before the subtree merge, or re-land it as a PR in
SDC-Tools afterwards. Doing neither loses it.

---

## 6. Phase 4 — The Scheduler, last or not at all

Now that Dan has SDC-Tools access, `SDC_Scheduler` *could* move. It should go **last**, and
only once Phases 0–3 are proven, for three reasons:

1. Its updater does **`git reset --hard origin/<branch>`** every 2 minutes. It is the most
   destructive process on the box, and it has a rollback path that assumes it owns the
   tree.
2. It runs under PM2 **as `NT AUTHORITY\SYSTEM`**, so `pm2` commands from a normal shell
   fail with `EPERM` on the pipe. Restarting it needs the `.update-sha` + `POST
   localhost:4013/trigger` trick, or an elevated shell.
3. `danbelliveau2/SDC_Scheduler` is the upstream Dan has always pushed to, and the
   monorepo still carries `dan` and `upstream` remotes pointing at it. Moving it is as much
   a change to Dan's habits as to the plumbing.

**A reasonable end state is to leave it where it is.** One repo for six apps plus a
separate Scheduler is not untidy — it reflects that the Scheduler has a different upstream
and a different deploy mechanism. Consolidate it only if the split is actively causing
friction.

---

## 7. Day to day, once this is in place

```
                    ┌──────────────────────────────┐
                    │  SDC-Tools (GitHub)          │
                    │  master = deployed           │
                    └──────────┬───────────────────┘
        PR + CI + review       │        fast-forward every 5 min
   ┌───────────────────────────┘                 │
   │                                             ▼
┌──┴──────────────┐  ┌─────────────────┐  ┌──────────────────────────┐
│ D:/sdc-abhi     │  │ D:/sdc-dan      │  │ Centrailized library     │
│ worktree, feat/ │  │ worktree, feat/ │  │ master · PM2 · nobody    │
│ dev on 3021 etc │  │ dev on own port │  │ edits this tree          │
└─────────────────┘  └─────────────────┘  └──────────────────────────┘
```

1. `git worktree add` a branch on your own path.
2. Build and test there, on a dev port.
3. Push the branch, open a PR, CI runs, the other reviews.
4. Squash-merge to `master`.
5. The updater deploys it within 5 minutes, builds the app, restarts it.
6. Verify on the real port.

**Never:** edit the production tree, push to `master` directly, or force-push `master`.

---

## 8. Traps that do not go away

- **`prisma generate` needs the app stopped.** `EPERM` while PM2 holds the DLL. Each failed
  attempt also leaves a ~21 MB orphaned `.tmp` file in `node_modules/.prisma/client` — five
  had accumulated to 105 MB before being cleared.
- **The Scheduler's PM2 process is SYSTEM-owned.** `pm2` from a normal shell fails on the
  pipe.
- **`npm run deploy` for Reports ends with `pm2 start`**, so a `prisma generate` chained
  after it fails — the app is already up again. Use `pm2 stop → generate → start`.
- **Two Monthly ETC grids in one page share autosave state.** `etc-dirty-tracker` keys
  unsaved cells by form field name in module scope, and a not-yet-created cell's name
  carries no month. Split view refuses ETC-beside-ETC for this reason; the same constraint
  applies to any future feature that mounts two grids.
- **The updaters do not cover every app.** After Phase 3, re-check `FRONTEND_BUILDS` and
  the restart list against `ecosystem.config.js` whenever an app is added.

---

## 9. What to decide

| # | Decision | Recommendation |
|---|---|---|
| 1 | Fix the CI trigger to `master`? | **Yes, first, today.** One line. |
| 2 | Worktrees, prod tree read-only? | **Yes.** This is the one that prevents lost work. |
| 3 | PR + branch protection on `master`? | **Yes.** Require CI, no force-push. |
| 4 | Reports + PowerBI into SDC-Tools? | **Yes**, after 1–3, with the updater fixed first. |
| 5 | Reports deploy: brief outage for Prisma? | **Yes (option B)** — a Next deploy restarts anyway. |
| 6 | Move the Scheduler too? | **Not yet.** Revisit once the rest is proven. |
| 7 | Land `feat/split-view-and-parts-projection` where? | Decide before the subtree merge. |

See also [APPLICATIONS.md](./APPLICATIONS.md), [DEPLOYMENT.md](./DEPLOYMENT.md) and
[DEVELOPMENT.md](./DEVELOPMENT.md), all of which currently describe Reports, PowerBI and the
Scheduler as separate repos with their own pipelines. They need updating as part of Phase 3.

---

## 10. What was actually done, and what is left

**Done on 2026-09-03**, commits `5bb1c4d` → `cfe9285` on `master`:

| Phase | Commit | What |
|---|---|---|
| 0 | `5bb1c4d` | CI triggers on `master`. It had never run. |
| 3a | `ee74a32` | Updater step 7b: stop → migrate → generate → build → start for Reports |
| 3 | `1c137a4` | `SDC-PowerBI-DEV` subtree-merged in, 320 files, history linked |
| 3 | `4e4b5ff` | `sdc-etc-planner` subtree-merged in, 792 files, history linked |
| 3 | `cfe9285` | Old nested `.git` dirs archived and ignored |
| 1 | — | Worktree at `D:/AI Projects/sdc-abhi`, `node_modules` junctioned |

Verified during the move: the Reports app stayed `200` on 4006 throughout, all seven PM2
apps still respond, `git diff --raw` found zero content differences against `90757fc`, and
`git rev-parse --show-toplevel` from inside `sdc-etc-planner` now returns the monorepo
root.

**Left to do, and it needs the GitHub UI or the `gh` CLI — neither is available on this
box:**

1. **Branch protection on `master`** (Phase 2): require a PR, require the CI check, block
   force-push. Until this is set, the "nobody pushes to `master`" rule is a convention
   rather than a guard — and these five commits went straight to `master` themselves,
   because the plumbing PRs depend on did not exist yet.
2. **Confirm CI ran.** Check the Actions tab for a run against `cfe9285`. If nothing
   appears, the workflow file has a second problem beyond the branch list.
3. **Set up Dan's worktree** on his own path, same two steps as §3.
4. **Archive `sdc-sheets` and `SDC-PowerBI`** on GitHub — do not delete. They are the
   fallback if the subtree merge needs undoing.
5. **Review what came in unreviewed.** `sdc-etc-planner` arrived at the tip of
   `feat/split-view-and-parts-projection`: split view, the Parts Cost projection rebuild,
   the Monthly ETC red highlight. Tests pass, nothing browser-verified.
6. **Phase 4 (the Scheduler)** — still recommended as *not yet*, for the three reasons
   in §6.

**Two things worth deciding while this is fresh:**

- `SDC-PowerBI-DEV/DEV-LOG.md`, `REDESIGN-PROMPT.md`, `ROADMAP.md`, `power bi new
  design/` and `revamp dashboard/` were untracked in the old repo and are still untracked
  here. They look like real documentation. Commit them, or add them to `.gitignore` — right
  now they are permanent `git status` noise.
- The monorepo still carries `dan` and `upstream` remotes pointing at
  `danbelliveau2/SDC_Scheduler`, plus the new `reports` and `powerbi` remotes. The latter
  two can be dropped once the move has settled (`git remote remove reports powerbi`).
