import type { NextConfig } from "next";
import { version as packageVersion } from "./package.json";

const nextConfig: NextConfig = {
  /* config options here */
  // The app version, from package.json, baked in at build time and read back
  // through lib/app-version.ts. Injected here rather than imported by the sidebar
  // so the browser bundle carries the version string and not the whole
  // package.json (dependency list included). See lib/app-version.ts.
  env: {
    NEXT_PUBLIC_APP_VERSION: packageVersion,
  },
  // Overridable so a second dev server (e.g. a preview) can run alongside
  // the main one — Next refuses two dev servers sharing one dist dir.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["server-app1", "localhost"],
  serverExternalPackages: ["@azure/msal-node-extensions"],
  // ── Pin the file-tracing root to THIS app (2026-08-27) ────────────────────
  //
  // This app is its own git repo that happens to sit inside the SDC Tools
  // monorepo's folder, so two lockfiles are visible: its own, and
  // "Centrailized library/package-lock.json" one level up. Next infers a
  // tracing root when it sees more than one, picked the OUTER directory, and
  // wrote a four-line warning into the PM2 error log on every single boot —
  // enough noise to bury a real error, which is the only reason to fix it.
  //
  // `__dirname` is this folder, which is the correct root: nothing this app
  // needs at runtime lives above it (the monorepo root holds the OTHER apps,
  // and this one imports none of them). `__dirname` rather than
  // `import.meta.dirname` because package.json declares no `"type": "module"`,
  // so the config is loaded as CommonJS.
  //
  // Not a no-op even without `output: "standalone"`: the inferred root also
  // decides which files a build traces, so pinning it narrows tracing to this
  // app instead of walking the whole monorepo. Verified with a full production
  // build after the change.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
