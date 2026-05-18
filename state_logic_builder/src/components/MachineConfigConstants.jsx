import React from 'react';

// ── Mini SVG icons for machine type cards ───────────────────────────────────
export function MiniDialIcon({ active }) {
  const c = '#1574C4';
  const bg = active ? '#dbeafe' : '#e0f2fe';
  return (
    <svg viewBox="0 0 48 48" width="40" height="40">
      <circle cx="24" cy="24" r="20" fill="none" stroke={bg} strokeWidth="2" />
      <circle cx="24" cy="24" r="5" fill={bg} stroke={c} strokeWidth="1" />
      {Array.from({ length: 10 }).map((_, i) => {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const x = 24 + 16 * Math.cos(a);
        const y = 24 + 16 * Math.sin(a);
        return <circle key={i} cx={x} cy={y} r="3" fill={c} opacity={0.8} />;
      })}
    </svg>
  );
}

export function MiniLinearIcon({ active }) {
  const c = '#1574C4';
  const bg = active ? '#dbeafe' : '#e0f2fe';
  return (
    <svg viewBox="0 0 56 32" width="48" height="28">
      <line x1="4" y1="16" x2="52" y2="16" stroke={bg} strokeWidth="2.5" strokeLinecap="round" />
      <polygon points="52,16 48,12 48,20" fill={c} opacity={0.5} />
      {Array.from({ length: 5 }).map((_, i) => {
        const x = 6 + i * 10;
        return <rect key={i} x={x} y="9" width="8" height="14" rx="2" fill={c} opacity={0.8} />;
      })}
    </svg>
  );
}

export function MiniRobotCellIcon({ active }) {
  const c = '#7c3aed';
  const bg = active ? '#ede9fe' : '#f5f3ff';
  return (
    <svg viewBox="0 0 48 48" width="40" height="40">
      <rect x="10" y="38" width="16" height="6" rx="2" fill={c} opacity={0.7} />
      <rect x="14" y="34" width="8" height="5" rx="1" fill={c} opacity={0.5} />
      <rect x="15" y="26" width="6" height="9" rx="2" fill={c} opacity={0.8} />
      <line x1="18" y1="26" x2="18" y2="14" stroke={c} strokeWidth="3" strokeLinecap="round" />
      <circle cx="18" cy="14" r="2.5" fill={bg} stroke={c} strokeWidth="1.5" />
      <line x1="18" y1="14" x2="32" y2="10" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="10" r="2" fill={bg} stroke={c} strokeWidth="1.5" />
      <line x1="32" y1="10" x2="38" y2="7" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <line x1="38" y1="5" x2="38" y2="9" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      {[[38, 22], [38, 34], [42, 42]].map(([x, y], i) => (
        <rect key={i} x={x - 3} y={y - 3} width="7" height="5" rx="1.5" fill={c} opacity={0.5} />
      ))}
    </svg>
  );
}

export function MiniTestIcon({ active }) {
  const c = '#d97706';
  const bg = active ? '#fde68a' : '#fef3c7';
  return (
    <svg viewBox="0 0 48 48" width="40" height="40">
      <line x1="8" y1="40" x2="8" y2="18" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="8" y1="18" x2="22" y2="12" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
      <rect x="20" y="6" width="16" height="12" rx="2" fill={bg} stroke={c} strokeWidth="2" />
      <circle cx="28" cy="12" r="4" fill="none" stroke={c} strokeWidth="1.5" />
      <circle cx="28" cy="12" r="1.5" fill={c} opacity={0.6} />
      <circle cx="28" cy="12" r="6" fill="none" stroke={c} strokeWidth="0.8" strokeDasharray="2 2" opacity={0.5} />
      <path d="M22,18 L16,34 L40,34 L34,18" fill={c} opacity={0.1} stroke={c} strokeWidth="0.8" strokeDasharray="3 2" />
      <rect x="18" y="36" width="20" height="4" rx="1" fill={c} opacity={0.4} />
      <rect x="24" y="32" width="8" height="4" rx="1" fill={c} opacity={0.6} />
      <rect x="4" y="40" width="8" height="4" rx="1" fill={c} opacity={0.6} />
    </svg>
  );
}

export function MiniCustomIcon({ active }) {
  const c = '#64748b';
  return (
    <svg viewBox="0 0 48 48" width="40" height="40">
      <circle cx="24" cy="24" r="8" fill="none" stroke={c} strokeWidth="2" />
      <circle cx="24" cy="24" r="3" fill={c} opacity={0.4} />
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2;
        const x1 = 24 + 10 * Math.cos(a);
        const y1 = 24 + 10 * Math.sin(a);
        const x2 = 24 + 14 * Math.cos(a);
        const y2 = 24 + 14 * Math.sin(a);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth="3" strokeLinecap="round" />;
      })}
    </svg>
  );
}

export const MACHINE_TYPE_ICONS = {
  indexing: MiniDialIcon,
  linear: MiniLinearIcon,
  robotCell: MiniRobotCellIcon,
  testInspect: MiniTestIcon,
  custom: MiniCustomIcon,
};

export const MACHINE_TYPES = [
  { id: 'indexing', label: 'Indexing Dial', description: 'Rotary indexing table with stations around the perimeter' },
  { id: 'linear', label: 'Linear Indexing', description: 'Parts move linearly from station to station' },
  { id: 'robotCell', label: 'Robot Cell', description: 'Robot-centric processing cell with peripheral stations' },
  { id: 'testInspect', label: 'Test & Inspection', description: 'Testing and inspection machine with verify stations' },
  { id: 'custom', label: 'Custom', description: 'Custom machine layout' },
];

export const STATION_TYPES = [
  { id: 'load', label: 'Load', color: '#1574C4' },
  { id: 'process', label: 'Process', color: '#7B2D8E' },
  { id: 'verify', label: 'Verify', color: '#E8A317' },
  { id: 'reject', label: 'Reject', color: '#DC2626' },
  { id: 'unload', label: 'Unload', color: '#5BB0D8' },
  { id: 'empty', label: 'Empty', color: '#94a3b8' },
];

export const AXIS_TYPES = [
  { id: 'pneumatic', label: 'Pneumatic' },
  { id: 'rotary',    label: 'Rotary Pneu' },
  { id: 'servo',     label: 'Servo' },
  { id: 'gripper',   label: 'Gripper' },
  { id: 'vacuum',    label: 'Vacuum' },
  { id: 'sensor',    label: 'Dig Sensor' },
  { id: 'analog',    label: 'Analog Probe' },
  { id: 'vision',    label: 'Vision' },
  { id: 'robot',     label: 'Robot' },
  { id: 'conveyor',  label: 'Conveyor' },
  { id: 'timer',     label: 'Timer' },
];

export const AXIS_LABELS = ['X', 'Z', 'A3', 'A4', 'A5', 'A6'];
export const DEFAULT_LOAD_AXES = [
  { label: 'X', type: 'pneumatic' },
  { label: 'Z', type: 'pneumatic' },
  { label: 'Grip', type: 'gripper' },
];
export const DEFAULT_UNLOAD_AXES = [
  { label: 'X', type: 'pneumatic' },
  { label: 'Z', type: 'pneumatic' },
  { label: 'Grip', type: 'gripper' },
];
export const VERIFY_TYPES = ['vision', 'sensor', 'mechanical'];
