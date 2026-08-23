/**
 * UpdateBanner — floats at the bottom of the launcher to surface auto-update state.
 *
 * Phases driven by electron-updater events forwarded via IPC:
 *   'checking'    → (silent, no banner)
 *   'none'        → (silent, no banner)
 *   'available'   → show "Update available — download?" prompt
 *   'downloading' → progress bar
 *   'ready'       → show "Restart to install" prompt
 *   'error'       → show dismissible error message
 */
export default function UpdateBanner({ status, onDownload, onInstall, onDismiss }) {
  if (!status) return null;
  const { phase, version, percent, message } = status;
  if (phase === 'checking' || phase === 'none') return null;

  return (
    <div className="update-banner" role="status" aria-live="polite">
      {phase === 'available' && (
        <>
          <span className="update-text">
            <span className="update-dot update-dot--blue" />
            SDC Tools <strong>v{version}</strong> is available
          </span>
          <div className="update-actions">
            <button className="btn btn-update" onClick={onDownload}>Download update</button>
            <button className="btn btn-update-dismiss" onClick={onDismiss}>Later</button>
          </div>
        </>
      )}

      {phase === 'downloading' && (
        <>
          <span className="update-text">
            <span className="update-dot update-dot--blue update-dot--pulse" />
            Downloading update… {percent}%
          </span>
          <div className="update-progress">
            <div className="update-progress-bar" style={{ width: `${percent}%` }} />
          </div>
        </>
      )}

      {phase === 'ready' && (
        <>
          <span className="update-text">
            <span className="update-dot update-dot--green" />
            <strong>v{version}</strong> downloaded — restart to install
          </span>
          <div className="update-actions">
            <button className="btn btn-update btn-update--green" onClick={onInstall}>
              Restart &amp; Install
            </button>
            <button className="btn btn-update-dismiss" onClick={onDismiss}>Later</button>
          </div>
        </>
      )}

      {phase === 'error' && (
        <>
          <span className="update-text update-text--error">
            <span className="update-dot update-dot--red" />
            Update failed: {message}
          </span>
          <button className="btn btn-update-dismiss" onClick={onDismiss}>Dismiss</button>
        </>
      )}
    </div>
  );
}
