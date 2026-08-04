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
};

export default nextConfig;
