import React from 'react';
import { STATION_TYPES } from './MachineConfigConstants.jsx';

export function LinearVisual({ stations, selectedId, onSelectStation, sms }) {
  const count = stations.length;
  if (count === 0) return <div className="machine-visual__empty">Add stations to see linear layout</div>;

  return (
    <div className="linear-visual">
      <div className="linear-visual__track">
        <div className="linear-visual__line" />
        <div className="linear-visual__arrow" />
      </div>
      <div className="linear-visual__stations" style={{ '--station-count': count }}>
        {stations.map((st) => {
          const stType = STATION_TYPES.find(t => t.id === st.type) ?? STATION_TYPES[0];
          const isSelected = st.id === selectedId;
          const linkedSms = (st.smIds ?? []).map(id => sms.find(s => s.id === id)).filter(Boolean);

          return (
            <div
              key={st.id}
              className={`linear-visual__station${isSelected ? ' linear-visual__station--selected' : ''}`}
              style={{
                borderColor: stType.color,
                background: isSelected ? stType.color : '#fff',
                color: isSelected ? '#fff' : stType.color,
              }}
              onClick={() => onSelectStation(st.id)}
            >
              <span className="linear-visual__station-id">
                S{String(st.number).padStart(2, '0')}
              </span>
              <span className="linear-visual__station-name" style={{ color: isSelected ? '#fff' : '#64748b' }}>
                {(st.name ?? '').substring(0, 14)}
              </span>
              {linkedSms.length > 0 && (
                <span className="linear-visual__sm-badge">{linkedSms.length}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
