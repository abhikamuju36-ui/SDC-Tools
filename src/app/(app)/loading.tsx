// Group-level loading state for /(app) pages. These tabs are server components
// that fetch from the DB (and sometimes Power BI / TotalETO), so without this
// the tab appears frozen on the previous page until the new one is ready. This
// renders inside the (app) layout, so the sidebar stays put and only the
// content area shows the indicator — instant feedback on every tab transition.
// Kept minimal (a centered spinner) rather than a full fake skeleton, which
// would flash misleadingly on the faster pages.
export default function AppLoading() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-8" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-3 text-sdc-gray-500">
        <svg className="animate-spin" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 1 1-6.2-8.6" strokeLinecap="round" />
        </svg>
        <span className="text-sm font-medium">Loading…</span>
      </div>
    </div>
  );
}
