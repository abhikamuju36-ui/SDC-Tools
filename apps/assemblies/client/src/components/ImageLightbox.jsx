/**
 * ImageLightbox.jsx
 * Full-screen in-app image viewer rendered via a React portal.
 * Click outside or press Escape to close. Click image to toggle zoom.
 */
import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import API_BASE from '../utils/apiBase';

export default function ImageLightbox({ href, title, onClose }) {
  const [zoomed, setZoomed]   = useState(false);
  const [errored, setErrored] = useState(false);

  // Resolve server-relative paths to full URL
  const url = !href ? null
    : href.startsWith('/') ? `${API_BASE}${href}`
    : href;

  // Escape key closes
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const toggleZoom = useCallback(e => {
    e.stopPropagation();
    setZoomed(z => !z);
  }, []);

  if (!url) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.90)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
        animation: 'lb-fade-in 0.15s ease',
      }}
      onClick={onClose}
    >
      {/* ── Close button ──────────────────────────────────────────────── */}
      <button
        onClick={onClose}
        title="Close (Esc)"
        style={{
          position: 'fixed', top: 18, right: 22,
          width: 38, height: 38, borderRadius: '50%',
          background: 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.2)',
          color: '#fff', fontSize: 22, lineHeight: 1,
          cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          zIndex: 10001, transition: 'background 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
      >×</button>

      {/* ── Zoom hint ─────────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', top: 22, left: '50%', transform: 'translateX(-50%)',
        color: 'rgba(255,255,255,0.45)', fontSize: 12,
        pointerEvents: 'none', userSelect: 'none',
      }}>
        {zoomed ? 'Click image to zoom out  ·  Esc to close' : 'Click image to zoom in  ·  Esc to close'}
      </div>

      {/* ── Image wrapper ─────────────────────────────────────────────── */}
      <div
        onClick={toggleZoom}
        style={{
          cursor: zoomed ? 'zoom-out' : 'zoom-in',
          overflow: zoomed ? 'auto' : 'visible',
          maxWidth: zoomed ? '96vw' : '88vw',
          maxHeight: zoomed ? '88vh' : '82vh',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {errored ? (
          <div style={{
            color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', padding: 40,
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🖼️</div>
            <div>Image could not be loaded</div>
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.6 }}>{url}</div>
          </div>
        ) : (
          <img
            src={url}
            alt={title || 'Assembly image'}
            onError={() => setErrored(true)}
            style={{
              display: 'block',
              maxWidth:  zoomed ? 'none' : '100%',
              maxHeight: zoomed ? 'none' : '100%',
              objectFit: 'contain',
              borderRadius: 10,
              boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
              transition: 'max-width 0.2s ease, max-height 0.2s ease',
            }}
          />
        )}
      </div>

      {/* ── Caption ───────────────────────────────────────────────────── */}
      {title && (
        <div style={{
          marginTop: 18, color: 'rgba(255,255,255,0.65)',
          fontSize: 13, fontFamily: 'monospace', letterSpacing: '0.03em',
          pointerEvents: 'none', userSelect: 'none',
        }}>
          {title}
        </div>
      )}

      <style>{`
        @keyframes lb-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>,
    document.body
  );
}
