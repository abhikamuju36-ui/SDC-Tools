import { ConfidentialClientApplication, PublicClientApplication } from "@azure/msal-node";
import { DataProtectionScope, PersistenceCreator, PersistenceCachePlugin } from "@azure/msal-node-extensions";
import fs from "fs/promises";
import path from "path";
import os from "os";
import * as XLSX from "xlsx";
import { ETC_TRACKED_CODES } from "@/lib/sections";

// Reads the Paylocity "Current_Job_Hours.xlsx" hours export directly from the
// SDC-PowerBIIntegration SharePoint site (Microsoft Graph, read-only), so the
// app no longer needs Power BI's dataset for hours worked. Uses the same
// cached delegated login the Power BI DAX client uses (Azure PowerShell
// public client), just with a Graph scope.
//
// Replicates Power BI's own Power Query transform on this file (verified
// 2026-07-19 to match PBI's [Hours Actual] by job/section to the hundredth
// for the closed month May 2026, 127/127):
//   - section code = MachineSec + "-" + Function   (e.g. "10" + "211")
//   - drop Function "417"
//   - split "10-311" into "10-312" (30%) and "10-313" (70%)
//   - keep only ETC-tracked section codes
//   - Work Date is an Excel serial date

const CLIENT_ID = "1950a258-227b-4e31-a9cf-717495945fc2"; // Azure PowerShell, pre-consented
const CACHE_PATH = path.join(os.homedir(), "AppData", "Local", "SdcPowerBiMcp", "msal_cache.bin");
const SITE = "stevendouglascorp.sharepoint.com:/sites/SDC-PowerBIIntegration";
const FILE_PATH = "Project Planner V2/Job Hours Report/Job Hours From Paylocity/Current_Job_Hours.xlsx";

let pca: PublicClientApplication | null = null;
let cca: ConfidentialClientApplication | null = null;

// ── App-only (client credentials) — the service-safe path ────────────────────
// Preferred when configured: no user, no session, no cache file on disk. The
// token is fetched per process and held in memory, so this works in Windows
// session 0, as a service, and after a reboot — none of which the delegated
// DPAPI cache below can survive (see explainTokenCacheFailure).
//
// Deliberately gated on its OWN env vars rather than falling back to the
// PBI_CLIENT_* service principal that powerbi-refresh.ts already uses. Those
// are already populated, so reusing them would silently switch this path on
// before the Graph grant exists — and app-only would then 401 where the
// delegated login works today. Verified 2026-07-29: that SP acquires a Graph
// token fine but carries no application permissions, so
// GET /sites/{...} returns 401 spException.
//
// To activate, the app registration needs a Graph APPLICATION permission with
// admin consent — Sites.Selected plus a read grant on just the
// SDC-PowerBIIntegration site is least privilege (Sites.Read.All also works but
// reads every site in the tenant). Then set:
//   GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET
function appOnlyConfigured(): boolean {
  return Boolean(process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET);
}

async function getAppOnlyToken(): Promise<string> {
  if (!cca) {
    cca = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.GRAPH_CLIENT_ID!,
        clientSecret: process.env.GRAPH_CLIENT_SECRET!,
        authority: `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}`,
      },
    });
  }
  const result = await cca.acquireTokenByClientCredential({ scopes: ["https://graph.microsoft.com/.default"] });
  if (!result?.accessToken) throw new Error("Failed to acquire an app-only Microsoft Graph token.");
  // A client-credentials token is issued even when the app has NO application
  // permissions — the failure only shows up later as an opaque 401
  // "spException" on the site lookup. The granted permissions ride in the
  // token's `roles` claim, so check here: an unusable token must be rejected
  // now, while the caller can still fall back to the delegated login.
  const roles = appRoles(result.accessToken);
  if (!roles.some((r) => /^Sites\.|^Files\./.test(r))) {
    throw new Error(
      `the app registration has no Graph Sites/Files application permission (roles: ${
        roles.length ? roles.join(", ") : "none"
      }). Grant Sites.Selected with admin consent, then give this app read on the SDC-PowerBIIntegration site.`
    );
  }
  return result.accessToken;
}

// Application permissions from an access token's `roles` claim. Read-only
// inspection of a token this process just acquired — not a validation step
// (Graph does that); [] whenever the claim is absent or unparseable.
function appRoles(token: string): string[] {
  try {
    const payload = token.split(".")[1];
    if (!payload) return [];
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as { roles?: string[] };
    return Array.isArray(claims.roles) ? claims.roles : [];
  } catch {
    return [];
  }
}

// The cache is encrypted with Windows DPAPI under DataProtectionScope.CurrentUser,
// so it can only be decrypted by the same Windows account that ran the login AND
// only from a session where that account's profile — and therefore its DPAPI
// master keys — are actually loaded. A process running in Windows' session 0
// (e.g. a PM2 daemon started as a service rather than from an interactive
// logon) cannot reach those keys and fails here with a bare
// "Encryption/Decryption failed. Error code: 3" (Win32 ERROR_PATH_NOT_FOUND),
// which names neither the file nor the real cause.
//
// This is not hypothetical: that exact failure silently killed every hours and
// parts sync from 2026-07-24 to 2026-07-29 — the ETC header kept showing the
// last good "Hours Refreshed Thru" date the whole time, so the numbers quietly
// aged instead of anything surfacing. Translate it into something a reader can
// act on.
function explainTokenCacheFailure(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/Encryption\/Decryption failed/i.test(msg)) return err instanceof Error ? err : new Error(msg);
  return new Error(
    `Cannot decrypt the SharePoint/Graph token cache at ${CACHE_PATH} (${msg}). ` +
      "That cache is DPAPI-encrypted for the Windows user who ran `sdc-powerbi-mcp.exe login`, " +
      "and is only readable from that user's own logged-on session. This process is most likely " +
      "running in Windows session 0 or as a different account — check that PM2 was started from " +
      "an interactive session for that user, rather than as a service."
  );
}

async function getGraphToken(): Promise<string> {
  // App-only first when configured. If it fails (e.g. the Sites.Selected grant
  // hasn't been applied yet, or the secret has expired) fall through to the
  // delegated cache rather than taking the sync down — the whole point of this
  // path is to make syncing MORE reliable, so it must never be the thing that
  // breaks it. The reason is logged so a half-finished rollout is visible.
  if (appOnlyConfigured()) {
    try {
      return await getAppOnlyToken();
    } catch (err) {
      console.warn(
        `[sharepoint-hours] app-only Graph auth failed, falling back to the delegated token cache: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return getDelegatedToken();
}

// ── Delegated (cached interactive login) — the legacy path ───────────────────
async function getDelegatedToken(): Promise<string> {
  if (!pca) {
    const persistence = await PersistenceCreator.createPersistence({
      cachePath: CACHE_PATH,
      dataProtectionScope: DataProtectionScope.CurrentUser,
      serviceName: "SdcPowerBiMcp",
      accountName: "SdcPowerBiMcp",
      usePlaintextFileOnLinux: false,
    });
    pca = new PublicClientApplication({
      auth: { clientId: CLIENT_ID, authority: "https://login.microsoftonline.com/organizations" },
      cache: { cachePlugin: new PersistenceCachePlugin(persistence) },
    });
  }
  // Both of these read the encrypted cache off disk, so either can raise the
  // DPAPI failure above.
  let accounts;
  try {
    accounts = await pca.getTokenCache().getAllAccounts();
  } catch (err) {
    throw explainTokenCacheFailure(err);
  }
  if (accounts.length === 0) {
    throw new Error("No cached login for SharePoint/Graph. Run `sdc-powerbi-mcp.exe login` once to authenticate this machine.");
  }
  let result;
  try {
    result = await pca.acquireTokenSilent({ account: accounts[0], scopes: ["https://graph.microsoft.com/.default"] });
  } catch (err) {
    throw explainTokenCacheFailure(err);
  }
  if (!result?.accessToken) throw new Error("Failed to acquire Microsoft Graph token silently.");
  return result.accessToken;
}

// `employeeId` is Paylocity's Employee Id, carried through so the punch-level
// Hours Detail drill can name who booked the time (resolved via
// Employee.paylocityId at read time). Empty string when the export omits it —
// the hours still count, they just can't be attributed.
export type JobHoursRow = {
  jobId: string;
  section: string;
  year: number;
  month: number;
  date: Date;
  hours: number;
  employeeId: string;
};

function serialToDate(serial: number): Date {
  // Excel's epoch is 1899-12-30 (accounts for the 1900 leap-year bug).
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

// Latest Work Date across the export — the "Hours Refreshed Thru" freshness figure.
export function latestWorkDate(rows: JobHoursRow[]): Date | null {
  let max: Date | null = null;
  for (const r of rows) if (!max || r.date > max) max = r.date;
  return max;
}

// ── Workbook source ──────────────────────────────────────────────────────────
// The same export is also synced to local disk by OneDrive (the SharePoint
// library added to Explorer). Reading that copy needs NO Graph token at all,
// which is the whole point: the delegated DPAPI cache above cannot be decrypted
// from a PM2/service process in Windows session 0, and that is what silently
// froze hours 2026-07-24..29 and again on 07-30.
//
// Verified 2026-07-31: the synced copy reproduces the Graph download exactly
// — Engineering 2368.85 / Shop 2526.38 for 2026-07, zero delta.
//
// The folder MUST be pinned "Always keep on this device". An unpinned
// Files-On-Demand placeholder is only a stub that hydrates via the OneDrive
// client running in an interactive session, so a service would fail to read it
// for exactly the same session-bound reason as the token cache.
const LOCAL_PATH = process.env.JOB_HOURS_LOCAL_PATH;

// A synced file whose sync has stopped ages silently — the same failure mode
// this path exists to cure. Past this age the copy is still USED (stale data
// beats no data, and Graph may be unavailable) but the staleness is reported.
const LOCAL_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

async function readLocalWorkbook(): Promise<Buffer | null> {
  if (!LOCAL_PATH) return null;
  try {
    const stat = await fs.stat(LOCAL_PATH);
    const ageHours = (Date.now() - stat.mtimeMs) / 3_600_000;
    if (ageHours > LOCAL_STALE_AFTER_MS / 3_600_000) {
      console.warn(
        `[sharepoint-hours] the local copy at ${LOCAL_PATH} is ${Math.round(ageHours)}h old — ` +
          "OneDrive may have stopped syncing (is the user still signed in?). Using it anyway."
      );
    }
    return await fs.readFile(LOCAL_PATH);
  } catch (err) {
    // Never fatal: fall through to Graph. A missing/unreadable local copy must
    // not take the sync down when the network path still works.
    console.warn(
      `[sharepoint-hours] could not read the local copy at ${LOCAL_PATH} ` +
        `(${err instanceof Error ? err.message : String(err)}); falling back to Microsoft Graph.`
    );
    return null;
  }
}

async function downloadWorkbookViaGraph(): Promise<Buffer> {
  const token = await getGraphToken();
  const H = { Authorization: `Bearer ${token}` };

  const siteResp = await fetch(`https://graph.microsoft.com/v1.0/sites/${SITE}`, { headers: H });
  if (!siteResp.ok) throw new Error(`Graph site lookup failed (HTTP ${siteResp.status}): ${(await siteResp.text()).slice(0, 200)}`);
  const siteId = ((await siteResp.json()) as { id: string }).id;

  const dl = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodeURI(FILE_PATH)}:/content`, { headers: H });
  if (!dl.ok) throw new Error(`Graph file download failed (HTTP ${dl.status}): ${(await dl.text()).slice(0, 200)}`);
  return Buffer.from(await dl.arrayBuffer());
}

// Reads and transforms the hours file into tracked per-row records. Prefers the
// locally synced copy when configured (no auth, works in session 0), otherwise
// downloads via Graph. Callers filter/aggregate by month in memory.
export async function fetchJobHoursRows(): Promise<JobHoursRow[]> {
  const buffer = (await readLocalWorkbook()) ?? (await downloadWorkbookViaGraph());
  const wb = XLSX.read(buffer, { type: "buffer" });
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });

  const out: JobHoursRow[] = [];
  // Time booked against something that isn't a job number. Tracked rather than
  // dropped on the floor: `Number("Not Defined")` is NaN, and the old code
  // stringified that straight into the job id, producing rows keyed "NaN" that
  // matched no Job and vanished with no trace anywhere. Measured 2026-07-31:
  // ~159 hours in July alone, about 7% of Engineering's month. That is a
  // real-world data-entry problem someone should chase, not something the
  // importer should hide.
  const unattributed = new Map<string, { rows: number; hours: number }>();
  const push = (jobId: string, section: string, date: Date, hours: number, employeeId: string) => {
    if (!ETC_TRACKED_CODES.has(section)) return;
    out.push({ jobId, section, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, date, hours, employeeId });
  };
  for (const r of raw) {
    const serial = Number(r["Work Date"]);
    if (!Number.isFinite(serial)) continue;
    const date = serialToDate(serial);
    const fn = String(r["Function"] ?? "").trim();
    if (fn === "417") continue; // dropped by PBI's transform
    const machineSec = String(r["MachineSec"] ?? "").trim();
    const rawJob = r["Jobs"];
    if (rawJob == null || String(rawJob).trim() === "") continue;
    const hours = Number(r["Total Hours Worked"]) || 0;

    // Must be a real job number. Anything else ("Not Defined", stray text) is
    // counted and skipped — never coerced into a fake id.
    const jobText = String(rawJob).trim();
    const jobNum = Number(jobText);
    if (!Number.isFinite(jobNum)) {
      const seen = unattributed.get(jobText) ?? { rows: 0, hours: 0 };
      unattributed.set(jobText, { rows: seen.rows + 1, hours: seen.hours + hours });
      continue;
    }
    const jobId = String(jobNum); // normalize leading zeros to match app job keys
    const employeeId = String(r["Employee Id"] ?? "").trim();
    const section = `${machineSec}-${fn}`;
    if (section === "10-311") {
      // Split into design (312, 30%) and software (313, 70%), per PBI. Both
      // halves keep the employee, so the Hours Detail drill shows one punch as
      // two attributed lines that still sum to what was booked.
      push(jobId, "10-312", date, hours * 0.3, employeeId);
      push(jobId, "10-313", date, hours * 0.7, employeeId);
    } else {
      push(jobId, section, date, hours, employeeId);
    }
  }
  if (unattributed.size > 0) {
    const summary = [...unattributed.entries()]
      .sort((a, b) => b[1].hours - a[1].hours)
      .map(([job, s]) => `"${job}" ${s.hours.toFixed(2)}h across ${s.rows} row(s)`)
      .join("; ");
    console.warn(
      `[sharepoint-hours] ${out.length} rows imported, but time was booked to non-job values and is NOT counted anywhere: ${summary}. ` +
        "Someone booked hours without a valid job number — worth chasing upstream in Paylocity."
    );
  }

  return out;
}

// Hours worked in a given calendar month, keyed "jobId::section". This is
// exactly what Power BI's [Hours Actual] filtered to that month returns.
export function hoursByJobSection(rows: JobHoursRow[], year: number, month: number): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.year !== year || r.month !== month) continue;
    const key = `${r.jobId}::${r.section}`;
    map.set(key, (map.get(key) ?? 0) + r.hours);
  }
  return map;
}
