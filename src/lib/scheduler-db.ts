import "server-only";
import mysql from "mysql2/promise";

// Read-only connection to the SDC Scheduler's MySQL (sdc_scheduler), used to
// mirror its team roster/grouping into ETC (see sync-scheduler-team.ts). The
// Scheduler owns team_members; ETC only ever READS it here.
//
// Fail-closed, exactly like scheduler-api-auth.ts: if SCHEDULER_DATABASE_URL is
// not set, the connector throws a clear error rather than guessing a host. That
// keeps the feature dormant until the connection string is deliberately set on
// the ETC host (both apps live on the same server, so this is a local reach).
//
// SCHEDULER_DATABASE_URL format:
//   mysql://user:pass@host:3306/sdc_scheduler
// A dedicated read-only MySQL user is strongly recommended.

const globalForSchedulerDb = globalThis as unknown as {
  schedulerPool: mysql.Pool | undefined;
};

export function isSchedulerDbConfigured(): boolean {
  return Boolean(process.env.SCHEDULER_DATABASE_URL);
}

function getPool(): mysql.Pool {
  const url = process.env.SCHEDULER_DATABASE_URL;
  if (!url) {
    throw new Error(
      "Scheduler sync is not configured: set SCHEDULER_DATABASE_URL (read-only MySQL) on the ETC host.",
    );
  }
  // Reuse one pool across HMR reloads / requests (same trick as prisma.ts).
  if (!globalForSchedulerDb.schedulerPool) {
    globalForSchedulerDb.schedulerPool = mysql.createPool({
      uri: url,
      connectionLimit: 3,
      // This app must never write to the Scheduler DB.
      // (Enforced by convention + a dedicated read-only user; we only SELECT.)
      namedPlaceholders: true,
    });
  }
  return globalForSchedulerDb.schedulerPool;
}

export type SchedulerTeamMember = {
  name: string;
  discipline: string;
  active: boolean;
  isLead: boolean;
  sortOrder: number | null;
  specialty: string | null;
};

// Real team members (placeholders like "ME Placeholder" are the Scheduler's own
// assignment stand-ins, not people, so they're always excluded). By default
// only active members; pass includeInactive for status reconciliation.
export async function fetchSchedulerTeam(includeInactive = false): Promise<SchedulerTeamMember[]> {
  const pool = getPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT name, discipline, active, is_lead, sort_order, specialty
       FROM team_members
      WHERE name NOT LIKE '%Placeholder%'
        ${includeInactive ? "" : "AND active = 1"}
      ORDER BY discipline, sort_order, name`,
  );
  return rows.map((r) => ({
    name: String(r.name),
    discipline: String(r.discipline),
    active: Boolean(r.active),
    isLead: Boolean(r.is_lead),
    sortOrder: r.sort_order == null ? null : Number(r.sort_order),
    specialty: r.specialty == null ? null : String(r.specialty),
  }));
}

// Set of ETC job numbers that already have a project in the Scheduler
// (projects.job_number is stamped with the ETC jobId when a schedule is
// created from an ETC job — see SDC_Scheduler routes/projects.js). Used by the
// grids to show the "open in Scheduler" icon ONLY for jobs that actually have a
// schedule, so it's never a dead link.
//
// Fail-SOFT (unlike fetchSchedulerTeam): if the read-only Scheduler DB isn't
// configured, or the query fails, this returns an empty set instead of throwing
// — the icon simply doesn't render and the rest of the page is unaffected.
export async function fetchSchedulerProjectJobNumbers(): Promise<Set<string>> {
  if (!isSchedulerDbConfigured()) return new Set();
  try {
    const pool = getPool();
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT DISTINCT job_number
         FROM projects
        WHERE job_number IS NOT NULL AND job_number <> ''`,
    );
    return new Set(rows.map((r) => String(r.job_number).trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}
