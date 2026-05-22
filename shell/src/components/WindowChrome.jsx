/** Electron custom title bar — draggable, with minimize/maximize/close controls */

const api = window.shellAPI ?? {}

export default function WindowChrome() {
  return (
    <div className="winbar">
      <div className="winbar-left">
        <div className="winbar-brand-tab">
          <span className="dot" />
          SDC Tools
        </div>
        <nav className="winbar-menu">
          <button>File</button>
          <button>Edit</button>
          <button>View</button>
          <button>Window</button>
          <button>Help</button>
        </nav>
      </div>
      <div className="winbar-controls">
        <button
          className="wc"
          aria-label="Minimize"
          onClick={() => api.windowMinimize?.()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="wc"
          aria-label="Maximize"
          onClick={() => api.windowMaximize?.()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
          </svg>
        </button>
        <button
          className="wc wc-close"
          aria-label="Close"
          onClick={() => api.windowClose?.()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
