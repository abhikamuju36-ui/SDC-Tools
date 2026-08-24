import React from 'react'

// ── The shell's own last line of defence (2026-08-24) ───────────────────────
//
// Every WEB app in the suite already had a boundary (Assemblies, Build
// Readiness, State Logic and Calendar each carry one; Reports has error.tsx +
// global-error.tsx). The shell's React UI had none at all — so an unhandled
// render error here white-screened the launcher itself, and the launcher is the
// one window a user cannot escape by closing a child app. That is exactly the
// reported "must close and reopen the application to recover".
//
// Worth being precise about what this does and does not cover, because the
// architecture makes a lot of the usual iframe-shell worry moot: child apps do
// NOT render inside the shell. openAppWindow() gives each one its own
// BrowserWindow with its own renderer process (there is no iframe, webview or
// embed anywhere in this codebase). So a child app crashing already cannot
// blank the shell — the OS process boundary guarantees it, and no error
// boundary is involved. What this boundary protects is the shell's OWN tree:
// the app grid, status bar, log panel, update banner, notifications.
//
// Recovery is offered rather than performed. An automatic reload was explicitly
// not wanted, and it would also be wrong here: reloading throws away the
// in-memory app-status state the shell has been polling for, and if the error is
// deterministic it would loop. So the user gets a button, and the reason is
// logged either way.

const NAVY = '#061d39'
const BLUE = '#1574c4'
const BORDER = '#d9d9d9'

export default class ShellErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Into the platform's central log, not just the console — a user who hits
    // this will close the window long before anyone opens DevTools.
    try {
      window.shellAPI?.logClientError?.({
        source: 'shell-ui',
        event: 'react-error-boundary',
        detail: `${error?.name || 'Error'}: ${error?.message || String(error)} | componentStack: ${info?.componentStack || 'n/a'}`,
      })
    } catch (_) { /* never let reporting be the reason recovery fails */ }
    console.error('[SDC Tools shell] render error caught by boundary:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    const message = this.state.error?.message || String(this.state.error)

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          background: '#f5f6f8',
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          color: '#2b2b2b',
          // Above the custom window chrome, so the card is never half-hidden
          // behind it when the shell is frameless.
          zIndex: 9999,
        }}
      >
        <div
          style={{
            maxWidth: '30rem',
            background: '#fff',
            border: `1px solid ${BORDER}`,
            borderRadius: '0.75rem',
            padding: '1.75rem',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.0625rem', color: NAVY }}>
            SDC Tools hit an unexpected error
          </h1>
          <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', lineHeight: 1.55 }}>
            The launcher stopped responding correctly. Any app you already have open is
            unaffected and still running — they are separate windows.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            {/* Try again first: re-mounting the tree fixes a transient render
                error without discarding the window or the update state. */}
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              style={{
                background: BLUE,
                color: '#fff',
                border: 'none',
                borderRadius: '0.5rem',
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            {/* A full reload of the renderer — the heavier option, and still
                far better than the user killing the process, which is what
                they were doing before this existed. */}
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                background: '#fff',
                color: NAVY,
                border: `1px solid ${BORDER}`,
                borderRadius: '0.5rem',
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload SDC Tools
            </button>
          </div>
          {/* The message, but not the stack: enough for a user to quote to IT,
              without pasting internals into a screenshot. The full stack and
              component tree are in sdc-tools-diagnostics.log. */}
          <p style={{ margin: '0.875rem 0 0', fontSize: '0.75rem', color: '#8a8a8a' }}>
            {message.slice(0, 160)}
          </p>
        </div>
      </div>
    )
  }
}
