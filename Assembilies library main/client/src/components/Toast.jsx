export default function Toast({ message, type = 'success', leaving = false, persistent = false, onDismiss }) {
  if (!message) return null;

  return (
    <div className={`toast-wrap toast-${type}${leaving ? ' leaving' : ''}`}>
      {type === 'success' ? (
        <svg className="toast-icon" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#fca5a5', flexShrink: 0 }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
      <span style={{ flex: 1 }}>{message}</span>

      {/* Persistent error toasts show an explicit dismiss button */}
      {persistent && onDismiss && (
        <button
          onClick={onDismiss}
          title="Dismiss"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '2px 4px', opacity: 0.7, color: 'inherit', lineHeight: 1,
            flexShrink: 0, marginLeft: 4,
          }}
          aria-label="Dismiss notification"
        >
          ✕
        </button>
      )}
    </div>
  );
}
