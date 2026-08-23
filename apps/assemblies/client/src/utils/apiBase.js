/**
 * Runtime API base URL.
 *
 * Priority:
 *  1. window.electron.apiBase  — injected by the Electron preload at startup
 *                                (e.g. "http://192.168.1.10:3001")
 *  2. import.meta.env.VITE_API_URL — set in .env for browser-only dev/staging
 *  3. ''  — empty string → all fetch paths are relative (works when the
 *            Express server itself serves the React app, e.g. `npm run start`)
 */
const API_BASE =
    (typeof window !== 'undefined' && window.electron?.apiBase) ||
    import.meta.env.VITE_API_URL ||
    '';

export default API_BASE;
