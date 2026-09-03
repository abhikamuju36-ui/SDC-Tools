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

/**
 * Opens a pool, runs `work`, and ALWAYS closes it.
 *
 * Every one of the ~20 call sites this replaces wrote its own
 * `const pool = await sql.connect(config); try { ... } finally { await
 * pool.close(); }`. Identical each time, and the one place to get it wrong is the
 * close — a pool leaked on an error path is a connection the SQL box keeps.
 */
export async function withTotalEto<T>(
  work: (pool: sql.ConnectionPool) => Promise<T>,
  requestTimeout: number = TOTALETO_TIMEOUT.sync,
): Promise<T> {
  const pool = await sql.connect(totalEtoConfig(requestTimeout));
  try {
    return await work(pool);
  } finally {
    await pool.close();
  }
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
