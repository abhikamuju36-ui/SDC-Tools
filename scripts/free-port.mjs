// ── Free a TCP port before starting the server (§71) ─────────────────────────
//
// PM2 on this Windows box does not reliably kill this app's server process. Measured
// 2026-08-06, three times in twenty minutes: `pm2 stop`, `pm2 restart` and even
// `pm2 delete` each reported success while the actual `next start` server kept running
// and kept the socket. The new instance then crash-loops on:
//
//     Error: listen EADDRINUSE: address already in use :::3010
//
// every ~4s, forever, while the OLD build carries on serving — so a deploy looks like it
// worked, the site looks up, and the new code is simply not live. That is the worst shape
// a deploy failure can take, because nothing announces it. (`↺ 364` on the PM2 entry was
// this loop, accumulated over many deploys.)
//
// So the documented deploy no longer trusts PM2 to have released the port: it frees it
// explicitly, then starts. Idempotent — if nothing is listening it says so and exits 0,
// which is the normal case on a healthy deploy.
//
// Deliberately dependency-free (no `kill-port` from npx): a deploy step that has to reach
// the network to free a local socket is a deploy step that fails when the network does.

import { execFileSync } from "node:child_process";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`free-port: expected a port number, got ${JSON.stringify(process.argv[2])}`);
  process.exit(1);
}

/** PIDs LISTENING on `port`, from netstat. Windows-only, which is this app's deploy target. */
function listenersOn(p) {
  let out = "";
  try {
    out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
  } catch (e) {
    console.error(`free-port: could not run netstat — ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    // Columns: Proto  Local Address  Foreign Address  State  PID
    const cols = line.trim().split(/\s+/);
    const local = cols[1] ?? "";
    const pid = Number(cols[cols.length - 1]);
    // Match the port EXACTLY — endsWith(":3010") would also match :13010, and killing
    // an unrelated service because of a substring match is far worse than a failed deploy.
    const portPart = local.slice(local.lastIndexOf(":") + 1);
    if (Number(portPart) === port && Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

const pids = listenersOn(port);
if (pids.length === 0) {
  console.log(`free-port: nothing listening on ${port} — nothing to do.`);
  process.exit(0);
}

let failed = 0;
for (const pid of pids) {
  try {
    execFileSync("taskkill", ["/F", "/PID", String(pid)], { encoding: "utf8", stdio: "pipe" });
    console.log(`free-port: killed PID ${pid} which held ${port}.`);
  } catch (e) {
    failed++;
    const detail = e instanceof Error ? e.message.split("\n")[0] : String(e);
    console.error(`free-port: could NOT kill PID ${pid} — ${detail}`);
  }
}

if (failed > 0) {
  // Fail the deploy loudly. Continuing to `pm2 restart` here is what produces the silent
  // failure this script exists to prevent: the restart "succeeds", the old build keeps
  // serving, and nobody finds out until someone asks why their change is not live.
  console.error(
    `free-port: ${failed} process(es) on ${port} survived. ` +
      `Run this shell as the user that owns them (or as Administrator) and retry — ` +
      `do NOT treat the deploy as done.`,
  );
  process.exit(1);
}

// The socket can linger a moment in TIME_WAIT after the process dies; give the OS a beat
// so the very next `next start` does not race it and report the same EADDRINUSE.
await new Promise((r) => setTimeout(r, 1500));
console.log(`free-port: ${port} is free.`);
