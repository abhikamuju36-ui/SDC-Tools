import React from 'react';
import { STATION_TYPES } from './MachineConfigConstants.jsx';

export function RobotCellVisual({ stations, selectedId, onSelectStation, sms }) {
  const count = stations.length;
  if (count === 0) return <div className="machine-visual__empty">Add stations to see cell layout</div>;

  const cx = 200, cy = 200, r = 140;

  return (
    <svg viewBox="0 0 400 400" className="machine-visual__svg">
      <rect x={30} y={30} width={340} height={340} rx={16} fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeDasharray="8 4" />
      <circle cx={cx} cy={cy} r={36} fill="#f5f3ff" stroke="#7c3aed" strokeWidth="2" />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="10" fill="#7c3aed" fontWeight="600">ROBOT</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="8" fill="#a78bfa">CELL</text>

      {stations.map((st, i) => {
        const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        const stType = STATION_TYPES.find(t => t.id === st.type) ?? STATION_TYPES[0];
        const isSelected = st.id === selectedId;
        const linkedSms = (st.smIds ?? []).map(id => sms.find(s => s.id === id)).filter(Boolean);

        return (
          <g key={st.id} className="station-click" onClick={() => onSelectStation(st.id)} style={{ cursor: 'pointer' }}>
            <rect x={x - 36} y={y - 24} width={72} height={48} rx={6}
              fill={isSelected ? stType.color : '#fff'}
              stroke={stType.color} strokeWidth={isSelected ? 3 : 1.5} />
            <text x={x} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="700"
              fill={isSelected ? '#fff' : stType.color}>
              S{String(st.number).padStart(2, '0')}
            </text>
            <text x={x} y={y + 8} textAnchor="middle" fontSize="7"
              fill={isSelected ? '#fff' : '#64748b'}>
              {(st.name ?? '').substring(0, 10)}
            </text>
            {linkedSms.length > 0 && (
              <>
                <circle cx={x + 30} cy={y - 18} r={7} fill="#befa4f" stroke="#1574C4" strokeWidth="1" />
                <text x={x + 30} y={y - 15} textAnchor="middle" fontSize="8" fontWeight="700" fill="#1574C4">
                  {linkedSms.length}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
