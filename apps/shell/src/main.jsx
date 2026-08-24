import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ShellErrorBoundary from './components/ShellErrorBoundary.jsx'
import './index.css'

// ── Catch what a React boundary structurally cannot (2026-08-24) ────────────
//
// ShellErrorBoundary handles errors thrown during render/lifecycle. These two
// listeners cover everything outside that: a throw inside a setTimeout or an
// event handler, and — the common one in this codebase — a rejected promise
// from an await'ed window.shellAPI.* IPC call that nothing catches.
//
// They deliberately do NOT change the UI. An unhandled rejection from a status
// poll is not a reason to replace a working launcher with an error card; the
// point here is that the failure stops being INVISIBLE. Previously it went to a
// DevTools console nobody has open, which is why "it just went white" arrived
// with no diagnostic trail. Now it lands in sdc-tools-diagnostics.log next to
// the child-app failures, with a timestamp.
function reportClientError(event, detail) {
  try {
    window.shellAPI?.logClientError?.({ source: 'shell-ui', event, detail })
  } catch (_) { /* reporting must never itself throw */ }
}

window.addEventListener('error', (e) => {
  // Resource errors (a failed <img>/<script>) also fire here but carry no
  // `error` object — worth logging, but distinguishable from a real exception.
  const detail = e.error
    ? `${e.error.name || 'Error'}: ${e.error.message || String(e.error)} @ ${e.filename || '?'}:${e.lineno || 0}`
    : `resource failed to load: ${e.target?.src || e.target?.href || 'unknown'}`
  reportClientError(e.error ? 'window-error' : 'resource-error', detail)
})

window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason
  reportClientError('unhandled-rejection', r?.stack || r?.message || String(r))
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ShellErrorBoundary>
      <App />
    </ShellErrorBoundary>
  </React.StrictMode>
)
