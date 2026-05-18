import React, { useState, useRef, useEffect, useCallback } from 'react';
import { STATION_TYPES } from './MachineConfigConstants.jsx';

export function DialVisual({ stations, selectedId, onSelectStation, sms }) {
  const count = stations.length;
  if (count === 0) return <div className="machine-visual__empty">Add stations to see dial layout</div>;

  // Scale radius so stations never overlap
  const stationR = 28;
  const minGap = 14;
  const minCircumference = count * (stationR * 2 + minGap);
  const r = Math.max(120, minCircumference / (2 * Math.PI));
  const fullSize = (r + stationR + 20) * 2;
  const cx = fullSize / 2, cy = fullSize / 2;

  const containerRef = useRef(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w: fullSize, h: fullSize });
  const dragRef = useRef({ active: false, startX: 0, startY: 0, origVb: null });
  const [focused, setFocused] = useState(false);

  const prevSize = useRef(fullSize);
  useEffect(() => {
    if (prevSize.current !== fullSize) {
      setVb({ x: 0, y: 0, w: fullSize, h: fullSize });
      prevSize.current = fullSize;
    }
  }, [fullSize]);

  function getZoomPct() { return Math.round((fullSize / vb.w) * 100); }

  const fullSizeRef = useRef(fullSize);
  fullSizeRef.current = fullSize;

  const zoomBy = useCallback((factor) => {
    setVb(v => {
      const fs = fullSizeRef.current;
      const newW = Math.max(fs * 0.05, Math.min(fs * 3, v.w / factor));
      const newH = newW;
      const cx2 = v.x + v.w / 2;
      const cy2 = v.y + v.h / 2;
      return { x: cx2 - newW / 2, y: cy2 - newH / 2, w: newW, h: newH };
    });
  }, []);

  const fitToView = useCallback(() => {
    setVb({ x: 0, y: 0, w: fullSizeRef.current, h: fullSizeRef.current });
  }, []);

  function handleMouseDown(e) {
    if (e.target.closest('.station-click') || e.target.closest('.dial-zoom-btn')) return;
    e.preventDefault();
    dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, origVb: { ...vb } };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }
  
  function handleMouseMove(e) {
    const d = dragRef.current;
    if (!d.active) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scaleX = d.origVb.w / rect.width;
    const scaleY = d.origVb.h / rect.height;
    const dx = (e.clientX - d.startX) * scaleX;
    const dy = (e.clientY - d.startY) * scaleY;
    setVb({ ...d.origVb, x: d.origVb.x - dx, y: d.origVb.y - dy });
  }
  
  function handleMouseUp() {
    dragRef.current.active = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }

  const focusedRef = useRef(false);
  focusedRef.current = focused;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e) => {
      if (!focusedRef.current) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const rect = el.getBoundingClientRect();
      setVb(v => {
        const fs = fullSizeRef.current;
        const newW = Math.max(fs * 0.05, Math.min(fs * 3, v.w / factor));
        const newH = newW;
        const mx = (e.clientX - rect.left) / rect.width;
        const my = (e.clientY - rect.top) / rect.height;
        const svgX = v.x + v.w * mx;
        const svgY = v.y + v.h * my;
        return { x: svgX - newW * mx, y: svgY - newH * my, w: newW, h: newH };
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  useEffect(() => {
    function handleDocClick(e) {
      const el = containerRef.current;
      if (!el) return;
      setFocused(el.contains(e.target));
    }
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, []);

  const btnStyle = { width: 32, height: 32, borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' };

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', userSelect: 'none', cursor: dragRef.current.active ? 'grabbing' : 'grab', outline: focused ? '2px solid #1574C4' : 'none', borderRadius: 8 }}
      onMouseDown={handleMouseDown}
    >
      <div className="dial-zoom-btn" style={{ position: 'absolute', top: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 4, zIndex: 5 }}>
        <button onClick={(e) => { e.stopPropagation(); zoomBy(1.4); }} style={btnStyle}>+</button>
        <button onClick={(e) => { e.stopPropagation(); zoomBy(1 / 1.4); }} style={btnStyle}>−</button>
        <button onClick={(e) => { e.stopPropagation(); fitToView(); }} title="Fit to view"
          style={{ ...btnStyle, fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>⊙</button>
      </div>
      <div style={{ position: 'absolute', bottom: 8, left: 8, fontSize: 11, color: '#94a3b8', zIndex: 5, pointerEvents: 'none' }}>
        {getZoomPct()}% — scroll to zoom, drag to pan
      </div>
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="machine-visual__svg machine-visual__svg--dial"
        preserveAspectRatio="xMidYMid meet">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="6 4" />
        <circle cx={cx} cy={cy} r={28} fill="#f1f5f9" stroke="#94a3b8" strokeWidth="1.5" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fill="#64748b" fontWeight="600">INDEX</text>

        <path d={`M ${cx + r + 12} ${cy - 20} A ${r + 12} ${r + 12} 0 0 1 ${cx + r + 12} ${cy + 20}`}
          fill="none" stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
            <polygon points="0 0, 6 2.5, 0 5" fill="#94a3b8" />
          </marker>
        </defs>

        {stations.map((st, i) => {
          const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
          const x = cx + r * Math.cos(angle);
          const y = cy + r * Math.sin(angle);
          const stType = STATION_TYPES.find(t => t.id === st.type) ?? STATION_TYPES[0];
          const isSelected = st.id === selectedId;
          const linkedSms = (st.smIds ?? []).map(id => sms.find(s => s.id === id)).filter(Boolean);

          return (
            <g key={st.id} className="station-click" onClick={(e) => { e.stopPropagation(); onSelectStation(st.id); }} style={{ cursor: 'pointer' }}>
              <circle
                cx={x} cy={y} r={stationR}
                fill={isSelected ? stType.color : stType.color + '30'}
                stroke={stType.color}
                strokeWidth={isSelected ? 3 : 2}
              />
              <text x={x} y={y - 4} textAnchor="middle" fontSize="11" fontWeight="700"
                fill={isSelected ? '#fff' : '#1e293b'}>
                S{String(st.number).padStart(2, '0')}
              </text>
              <text x={x} y={y + 8} textAnchor="middle" fontSize="7"
                fill={isSelected ? '#fff' : '#475569'}>
                {(st.name ?? '').substring(0, 10)}
              </text>
              {linkedSms.length > 0 && (
                <circle cx={x + stationR - 4} cy={y - stationR + 4} r={7} fill="#befa4f" stroke="#1574C4" strokeWidth="1" />
              )}
              {linkedSms.length > 0 && (
                <text x={x + stationR - 4} y={y - stationR + 7} textAnchor="middle" fontSize="8" fontWeight="700" fill="#1574C4">
                  {linkedSms.length}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
