// Starts the app's one refresh schedule. WHAT gets refreshed, and the rules it
// follows, live in lib/auto-sync.ts — this file only decides when it runs.
export async function register() {
  // register() runs in both the Node.js and Edge runtimes (the latter for
  // proxy.ts/middleware). Every sync behind runAllSyncs pulls in Node-only
  // modules — mssql, MSAL's native token cache, fs — which cannot load under
  // Edge, so skip entirely there.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as typeof globalThis & { __sdcAutoSyncStarted?: boolean };
  if (g.__sdcAutoSyncStarted) return; // guard against HMR / repeated registration
  g.__sdcAutoSyncStarted = true;

  const { runAllSyncs, SYNC_INTERVAL_MS } = await import("@/lib/auto-sync");

  // Once at boot, then every 6 hours. Note there is still NO retry policy: the
  // interval is happy-path spacing, so a failed pass waits the full six hours.
  // That trade is only survivable because every step records its own failure
  // where the app can show it — see auto-sync.ts rule 3.
  const tick = (trigger: "startup" | "interval") => {
    // runAllSyncs catches per step, so a rejection reaching here means the runner
    // itself broke. Caught anyway: an unhandled rejection can take the process
    // down, and losing the server is a worse outcome than losing one pass.
    runAllSyncs(trigger).catch((err) => console.error("[auto-sync] pass could not run:", err));
  };

  tick("startup");
  setInterval(() => tick("interval"), SYNC_INTERVAL_MS);
}
