import "server-only";
import sql from "mssql";

// ── The ONE Total ETO connection (2026-09-01) ────────────────────────────────
//
// Written after all four Total ETO refresh sources failed at once — Parts cost,
// Parts cost actual, Jobs from TotalETO and the Cash Flow snapshot — and the
// investigation had to establish, from scratch, that they shared a cause.
//
// They did, and the code made that harder to see than it should have been: the
// identical connection config existed FOUR TIMES, in sync-totaleto.ts,
// cash-flow-totaleto.ts, cash-flow-drill.ts and job-bom.ts. Same server, same
// database, same credentials, same domain, same options — differing only in
// requestTimeout. Four copies of one dependency, so "is this one shared failure
// or four separate ones" was a question the source could not answer.
//
// It is one module now. A credential change is one edit; a failure is one
// diagnosis; and `requestTimeout` stays per-caller because those differences are
// real (a BOM query legitimately needs longer than a job list).
//
// ── The failure this was written for ────────────────────────────────────────
//
//   ConnectionError: Login failed. The login is from an untrusted domain and
//   cannot be used with Integrated authentication.          code: ELOGIN
//
// `domain: "stevendouglas"` makes tedious authenticate over NTLM as
// stevendouglas\<user> rather than with a SQL Server login, so this connection
// depends on the domain account staying valid. On 2026-09-01 it stopped: the
// 14:02 refresh pass had all four sources green, the 14:21 pass had all four
// failing, and there is no ELOGIN anywhere in the preceding week of logs.
// Verified against the server directly — the credentials in .env are rejected,
// and a plain SQL-auth attempt answers "Login failed for user 'akamuju'", which
// means the server is reachable and refusing us rather than unreachable.
//
// That is a credentials problem, not a code one. What WAS a code problem is that
// nothing said so: each source surfaced a raw mssql sentence about "Integrated
// authentication" into a toast, which reads like an app fault. classifyTotalEto
// below is what turns it into something actionable.

/** Where Total ETO lives. Hardcoded before this file existed — in four places. */
const SERVER = "SERVER-APP1.stevendouglas.local";
const DATABASE = "SDC";
const DOMAIN = "stevendouglas";

/**
 * Longest a single query may run. Per-caller because the differences are real
 * and were already in the four copies: a job list is quick, a BOM walk is not.
 */
export const TOTALETO_TIMEOUT = {
  /** Job/parts sync queries. */
  sync: 30_000,
  /** The Cash Flow forecast query set. */
  cashFlow: 60_000,
  /** A full BOM walk. */
  bom: 120_000,
} as const;

/**
 * The connection config. Reads the credentials at CALL time, not at module load,
 * so updating .env and restarting is all it takes — and so a test can see the
 * same values the app does.
 */
export function totalEtoConfig(requestTimeout: number = TOTALETO_TIMEOUT.sync): sql.config {
  return {
    server: SERVER,
    database: DATABASE,
    user: process.env.TOTALETO_DB_USER,
    password: process.env.TOTALETO_DB_PASSWORD,
    // NTLM, not a SQL login — see the header. This is why the connection depends
    // on a domain account rather than on a value only this app knows.
    domain: DOMAIN,
    port: 1433,
    options: { trustServerCertificate: true, encrypt: false },
    connectionTimeout: 15_000,
    requestTimeout,
    // ── Bounded, and idle connections handed back ────────────────────────────
    //
    // mssql's defaults are max 10 / min 0 / idle 30s. `min: 0` is the important one
    // and is kept: pools below are long-lived, so anything above zero would hold
    // connections on the SQL box for the life of the process. With zero, an idle pool
    // holds nothing and the next query reopens as needed.
    //
    // max is lowered to 5 because there are now a handful of pools (one per distinct
    // requestTimeout) rather than one: 5 x a few pools is a sane ceiling on what this
    // app can hold against Total ETO, and no query path here needs more than a
    // handful of concurrent connections (the widest fan-out in the app is 6, and it
    // is spread across pools).
    pool: { max: 5, min: 0, idleTimeoutMillis: 30_000 },
  };
}

export type TotalEtoFailure =
  /** The server answered and refused the credentials. Someone must fix .env or the account. */
  | "login_rejected"
  /** Never got that far: DNS, routing, firewall, server down. */
  | "unreachable"
  /** Connected, but the query outran its timeout. */
  | "timeout"
  /** Anything else — a genuine bug in our own SQL, most likely. */
  | "other";

/**
 * What KIND of failure this is, so a caller can say something true about it.
 *
 * The distinction that matters operationally: `login_rejected` means nothing in
 * this app will work against Total ETO until a person changes a credential, and
 * retrying on the hourly schedule cannot help. `unreachable` and `timeout` are
 * the opposite — worth retrying, probably transient. Reporting all three as
 * "failed" is what made a two-hour credential outage look like a flaky feed.
 */
export function classifyTotalEto(error: unknown): TotalEtoFailure {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "ELOGIN" || /Login failed/i.test(message)) return "login_rejected";
  if (code === "ETIMEOUT" || code === "ETIMEOUTREQUEST" || /timeout/i.test(message)) return "timeout";
  if (
    code === "ESOCKET" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH" ||
    /getaddrinfo|socket hang up/i.test(message)
  ) {
    return "unreachable";
  }
  return "other";
}

/**
 * A sentence for a refresh log or a toast. Says what is wrong, where, and who has
 * to do something about it — rather than quoting mssql at a manager.
 */
export function describeTotalEtoFailure(error: unknown): string {
  const kind = classifyTotalEto(error);
  const raw = error instanceof Error ? error.message : String(error);
  switch (kind) {
    case "login_rejected":
      return (
        `Total ETO rejected the login for "${process.env.TOTALETO_DB_USER ?? "(no user configured)"}" on ${SERVER}. ` +
        `The TOTALETO_DB_USER / TOTALETO_DB_PASSWORD in .env are no longer accepted — the domain password has changed, ` +
        `expired, or the account is locked. Retrying will not help until they are updated. (${raw})`
      );
    case "unreachable":
      return `Total ETO (${SERVER}) could not be reached — server, network or firewall. Worth retrying. (${raw})`;
    case "timeout":
      return `Total ETO (${SERVER}) accepted the connection but the query timed out. Worth retrying. (${raw})`;
    default:
      return `Total ETO query failed against ${SERVER}. (${raw})`;
  }
}

// ── One long-lived pool per timeout, and never sql.connect (2026-09-03) ─────
//
// This replaces `sql.connect(config)` + `pool.close()`, which every Total ETO call
// site used and which is actively broken. Both faults are visible in
// node_modules/mssql/lib/global-connection.js:
//
//   1. `connect(config)` begins `if (!globalConnection)`. The config is therefore
//      used ONLY on the first call in the process; every later call gets the pool
//      that already exists and its config is SILENTLY DISCARDED. So
//      `sql.connect({ ...config, requestTimeout: 300000 })` did not give that query
//      300 seconds — it gave it whichever timeout won the race at startup.
//
//   2. `pool.close()` on the global pool sets `globalConnection = null` and closes
//      the pool FOR EVERY CONCURRENT USER. Any in-flight request on it fails with
//      `Error: aborted`.
//
// Fault 2 is the cause of the bug this was written for. The Monthly ETC grid's
// Left to Purchase column read $0 on every job, from
// `[parts-etc-breakout] batched parts lines failed: Error: aborted` — the 49-job
// parts-lines query takes ~3s, which is a wide window for any other Total ETO
// caller (the hourly refresh, a BOM read, another user's page) to finish and close
// the pool underneath it. A one-job query usually won that race, which is exactly
// why this looked like "only breaks with a lot of jobs".
//
// The fix is to stop sharing the GLOBAL pool and stop closing pools at all. A
// dedicated `new sql.ConnectionPool` per distinct requestTimeout, cached and kept
// open, is what a connection pool is for: honours each caller's timeout (fault 1),
// cannot be closed under a concurrent request (fault 2), and with `min: 0` holds no
// connections while idle, so nothing leaks.
//
// The cache hangs off globalThis so a dev hot-reload re-evaluating this module
// reuses the pools it already opened rather than stacking a new set on every edit
// — the same reason lib/prisma.ts does it.
type PoolCache = Map<number, Promise<sql.ConnectionPool>>;
const globalForPools = globalThis as typeof globalThis & { __sdcTotalEtoPools?: PoolCache };
const poolCache: PoolCache = (globalForPools.__sdcTotalEtoPools ??= new Map());

/**
 * The shared pool for this timeout, opening it on first use.
 *
 * A pool that has died (network drop, server restart) is discarded and rebuilt
 * rather than handed out — otherwise one transient outage would poison every later
 * query in the process.
 */
export async function totalEtoPool(requestTimeout: number = TOTALETO_TIMEOUT.sync): Promise<sql.ConnectionPool> {
  const cached = poolCache.get(requestTimeout);
  if (cached) {
    try {
      const pool = await cached;
      if (pool.connected) return pool;
    } catch {
      // Fall through and rebuild. The rejection is already reported to whoever
      // awaited it first; a later caller should get a fresh attempt, not a replay.
    }
    poolCache.delete(requestTimeout);
  }

  const opening = new sql.ConnectionPool(totalEtoConfig(requestTimeout)).connect();
  poolCache.set(requestTimeout, opening);
  // A failed open must not stay cached, or the process never retries. Guarded on
  // identity so a rebuild that has already replaced this entry is not evicted.
  opening.catch(() => {
    if (poolCache.get(requestTimeout) === opening) poolCache.delete(requestTimeout);
  });
  return opening;
}

/**
 * Runs `work` against the shared pool for `requestTimeout`.
 *
 * Deliberately does NOT close anything — see the header. `work` may safely run
 * concurrently with any other caller.
 */
export async function withTotalEto<T>(
  work: (pool: sql.ConnectionPool) => Promise<T>,
  requestTimeout: number = TOTALETO_TIMEOUT.sync,
): Promise<T> {
  const pool = await totalEtoPool(requestTimeout);
  return work(pool);
}

/** Closes every cached pool. For a test teardown or a deliberate shutdown, not for a request. */
export async function closeTotalEtoPools(): Promise<void> {
  const entries = [...poolCache.entries()];
  poolCache.clear();
  await Promise.allSettled(entries.map(async ([, p]) => (await p).close()));
}

/**
 * Can we log in at all? One cheap round trip, for a refresh pass to ask BEFORE it
 * runs four sources that will each fail the same way.
 *
 * Returns rather than throws: the caller wants to branch on this, not handle an
 * exception.
 */
export async function checkTotalEtoLogin(): Promise<{ ok: true } | { ok: false; kind: TotalEtoFailure; detail: string }> {
  try {
    await withTotalEto(async (pool) => pool.request().query("SELECT 1 AS ok"));
    return { ok: true };
  } catch (error) {
    return { ok: false, kind: classifyTotalEto(error), detail: describeTotalEtoFailure(error) };
  }
}
