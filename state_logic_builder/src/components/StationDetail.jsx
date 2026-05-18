import React, { useState, useRef, useEffect } from 'react';
import { STATION_TYPES } from './MachineConfigConstants.jsx';

export function StationDetail({ station, sms, onUpdate, onLinkSm, onUnlinkSm, onPrev, onNext, hasPrev, hasNext, totalStations }) {
  const [smDropdownOpen, setSmDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => { setSmDropdownOpen(false); }, [station?.id]);

  useEffect(() => {
    if (!smDropdownOpen) return;
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setSmDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [smDropdownOpen]);

  if (!station) return (
    <div className="station-detail__empty">
      Select a station on the visual to edit its properties
    </div>
  );

  const linkedSms = (station.smIds ?? []).map(id => sms.find(s => s.id === id)).filter(Boolean);
  const availableSms = sms.filter(s => !(station.smIds ?? []).includes(s.id));
  const stType = STATION_TYPES.find(t => t.id === station.type) ?? STATION_TYPES[0];

  return (
    <div className="station-detail">
      <div className="station-detail__header" style={{ borderLeftColor: stType.color }}>
        <span className="station-detail__number">S{String(station.number).padStart(2, '0')}</span>
        <input
          className="station-detail__name-input"
          value={station.name}
          onChange={e => onUpdate(station.id, { name: e.target.value })}
          placeholder="Station name"
        />
      </div>
      <div className="station-detail__nav-row">
        <button
          className={`station-detail__nav-pill${!hasPrev ? ' station-detail__nav-pill--disabled' : ''}`}
          onClick={onPrev}
          disabled={!hasPrev}
          title="Previous station"
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M8 1L3 6l5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Prev
        </button>
        <span className="station-detail__nav-label">{station.number} / {totalStations}</span>
        <button
          className={`station-detail__nav-pill${!hasNext ? ' station-detail__nav-pill--disabled' : ''}`}
          onClick={onNext}
          disabled={!hasNext}
          title="Next station"
        >
          Next
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M4 1l5 5-5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>

      <div className="station-detail__field">
        <label>Station Type</label>
        <div className="station-detail__type-grid">
          {STATION_TYPES.map(t => (
            <button
              key={t.id}
              className={`station-detail__type-btn${station.type === t.id ? ' station-detail__type-btn--active' : ''}`}
              style={{ '--type-color': t.color }}
              onClick={() => {
                const updates = { type: t.id };
                if (t.id === 'empty') updates.name = 'Empty';
                onUpdate(station.id, updates);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="station-detail__field">
        <label>Linked State Machines</label>
        {linkedSms.length > 0 ? (
          <div className="station-detail__sm-list">
            {linkedSms.map(sm => (
              <div key={sm.id} className="station-detail__sm-item">
                <span className="station-detail__sm-badge">S{String(sm.stationNumber).padStart(2, '0')}</span>
                <span>{sm.displayName ?? sm.name}</span>
                <button
                  className="station-detail__sm-remove"
                  onClick={() => onUnlinkSm(station.id, sm.id)}
                  title="Unlink"
                >×</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="station-detail__hint">No state machines linked to this station</p>
        )}
        {availableSms.length > 0 && (
          <div ref={dropdownRef} style={{ position: 'relative' }} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
            <button
              className="station-detail__sm-add-btn"
              onClick={() => setSmDropdownOpen(o => !o)}
              style={{ width: '100%', padding: '6px 10px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', textAlign: 'left', fontSize: 13, color: '#64748b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span>+ Link State Machine...</span>
              <span style={{ fontSize: 10 }}>{smDropdownOpen ? '▲' : '▼'}</span>
            </button>
            {smDropdownOpen && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 20, maxHeight: 200, overflowY: 'auto', marginTop: 2 }}>
                {availableSms.map(sm => (
                  <button
                    key={sm.id}
                    onClick={() => { onLinkSm(station.id, sm.id); }}
                    style={{ display: 'block', width: '100%', padding: '8px 12px', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 13, color: '#1e293b' }}
                    onMouseEnter={e => e.target.style.background = '#f1f5f9'}
                    onMouseLeave={e => e.target.style.background = 'none'}
                  >
                    <span style={{ color: '#1574C4', fontWeight: 700, marginRight: 6 }}>S{String(sm.stationNumber).padStart(2, '0')}</span>
                    {sm.displayName ?? sm.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {station.type === 'verify' && (
        <div className="station-detail__field">
          <label>
            <input
              type="checkbox"
              checked={station.bypass ?? false}
              onChange={e => onUpdate(station.id, { bypass: e.target.checked })}
            />
            Bypass capable
          </label>
          <label style={{ marginTop: 4, display: 'block' }}>
            <input
              type="checkbox"
              checked={station.lockout ?? false}
              onChange={e => onUpdate(station.id, { lockout: e.target.checked })}
            />
            Lockout capable
          </label>
        </div>
      )}
    </div>
  );
}
