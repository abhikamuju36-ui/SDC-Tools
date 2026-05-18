// SDC Tools — per-app icon SVGs (52×52 rounded-square)
// Each icon's accent color is driven by the `tint` prop.
// All icons use only SVG primitives — no external markers or defs references.

function AppIconAssemblies({ tint }) {
  // Isometric stacked cubes — represents the assembly vault
  return (
    <svg viewBox="0 0 52 52" width="52" height="52" xmlns="http://www.w3.org/2000/svg">
      <rect width="52" height="52" rx="12" fill={tint} fillOpacity="0.12" />
      <rect x="0.5" y="0.5" width="51" height="51" rx="11.5" fill="none" stroke={tint} strokeOpacity="0.4" strokeWidth="1" />
      {/* Top cube */}
      <g transform="translate(26 14)">
        <polygon points="0,-7 9,-2 0,3 -9,-2" fill={tint} fillOpacity="0.90" />
        <polygon points="-9,-2 -9,6 0,11 0,3" fill={tint} fillOpacity="0.45" />
        <polygon points="9,-2 9,6 0,11 0,3"  fill={tint} fillOpacity="0.65" />
      </g>
      {/* Bottom-left cube */}
      <g transform="translate(17 26)">
        <polygon points="0,-7 9,-2 0,3 -9,-2" fill={tint} fillOpacity="0.75" />
        <polygon points="-9,-2 -9,6 0,11 0,3" fill={tint} fillOpacity="0.35" />
        <polygon points="9,-2 9,6 0,11 0,3"  fill={tint} fillOpacity="0.55" />
      </g>
      {/* Bottom-right cube */}
      <g transform="translate(35 26)">
        <polygon points="0,-7 9,-2 0,3 -9,-2" fill={tint} fillOpacity="0.75" />
        <polygon points="-9,-2 -9,6 0,11 0,3" fill={tint} fillOpacity="0.35" />
        <polygon points="9,-2 9,6 0,11 0,3"  fill={tint} fillOpacity="0.55" />
      </g>
    </svg>
  );
}

function AppIconBuildReadiness({ tint }) {
  // Horizontal progress bars + checkmark — build status at a glance
  return (
    <svg viewBox="0 0 52 52" width="52" height="52" xmlns="http://www.w3.org/2000/svg">
      <rect width="52" height="52" rx="12" fill={tint} fillOpacity="0.12" />
      <rect x="0.5" y="0.5" width="51" height="51" rx="11.5" fill="none" stroke={tint} strokeOpacity="0.4" strokeWidth="1" />
      <g transform="translate(9 12)">
        {/* Track */}
        <rect x="0" y="0"  width="34" height="6" rx="3" fill={tint} fillOpacity="0.18" />
        <rect x="0" y="10" width="34" height="6" rx="3" fill={tint} fillOpacity="0.18" />
        <rect x="0" y="20" width="34" height="6" rx="3" fill={tint} fillOpacity="0.18" />
        {/* Fill */}
        <rect x="0" y="0"  width="30" height="6" rx="3" fill={tint} fillOpacity="0.95" />
        <rect x="0" y="10" width="20" height="6" rx="3" fill={tint} fillOpacity="0.80" />
        <rect x="0" y="20" width="25" height="6" rx="3" fill={tint} fillOpacity="0.65" />
        {/* Checkmark */}
        <path d="M 20 29 L 25 34 L 34 24"
              fill="none" stroke={tint} strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
              strokeOpacity="0.9" />
      </g>
    </svg>
  );
}

function AppIconScheduler({ tint }) {
  // Gantt-style chart with a date marker line
  return (
    <svg viewBox="0 0 52 52" width="52" height="52" xmlns="http://www.w3.org/2000/svg">
      <rect width="52" height="52" rx="12" fill={tint} fillOpacity="0.12" />
      <rect x="0.5" y="0.5" width="51" height="51" rx="11.5" fill="none" stroke={tint} strokeOpacity="0.4" strokeWidth="1" />
      <g transform="translate(10 12)">
        {/* vertical grid lines */}
        {[0,8,16,24,32].map(x => (
          <line key={x} x1={x} y1="0" x2={x} y2="28"
                stroke={tint} strokeOpacity="0.15" strokeWidth="1" />
        ))}
        {/* Gantt bars */}
        <rect x="1"  y="2"  width="14" height="6" rx="2.5" fill={tint} fillOpacity="0.95" />
        <rect x="9"  y="11" width="20" height="6" rx="2.5" fill={tint} fillOpacity="0.75" />
        <rect x="4"  y="20" width="24" height="6" rx="2.5" fill={tint} fillOpacity="0.55" />
        {/* today marker */}
        <line x1="23" y1="-1" x2="23" y2="29"
              stroke={tint} strokeWidth="1.5" strokeOpacity="0.8" strokeDasharray="2 2" />
        <polygon points="20,-1 26,-1 23,3" fill={tint} fillOpacity="0.8" />
      </g>
    </svg>
  );
}

function AppIconStateLogic({ tint }) {
  // State machine diagram: 3 nodes with directional arrows (no external markers)
  return (
    <svg viewBox="0 0 52 52" width="52" height="52" xmlns="http://www.w3.org/2000/svg">
      <rect width="52" height="52" rx="12" fill={tint} fillOpacity="0.12" />
      <rect x="0.5" y="0.5" width="51" height="51" rx="11.5" fill="none" stroke={tint} strokeOpacity="0.4" strokeWidth="1" />
      <g transform="translate(7 11)">
        {/* Arrows drawn as paths with arrowhead polys — no marker refs */}
        {/* A → B  (horizontal) */}
        <line x1="13" y1="9" x2="24" y2="9" stroke={tint} strokeWidth="1.6" strokeOpacity="0.8" strokeLinecap="round" />
        <polygon points="26,9 22,7 22,11" fill={tint} fillOpacity="0.8" />
        {/* B → C  (diagonal down-left) */}
        <line x1="27" y1="14" x2="22" y2="24" stroke={tint} strokeWidth="1.6" strokeOpacity="0.8" strokeLinecap="round" />
        <polygon points="21,27 20,22 25,23" fill={tint} fillOpacity="0.8" />
        {/* C → A  (diagonal up-left) */}
        <line x1="16" y1="27" x2="9" y2="14" stroke={tint} strokeWidth="1.6" strokeOpacity="0.8" strokeLinecap="round" />
        <polygon points="8,11 7,16 12,14" fill={tint} fillOpacity="0.8" />
        {/* Node A — initial (filled) */}
        <circle cx="8"  cy="9"  r="6" fill={tint} fillOpacity="0.9" />
        {/* Node B */}
        <circle cx="29" cy="9"  r="6" fill={tint} fillOpacity="0.55" stroke={tint} strokeOpacity="0.6" strokeWidth="1.2" />
        {/* Node C — terminal (double ring) */}
        <circle cx="19" cy="30" r="6" fill={tint} fillOpacity="0.35" stroke={tint} strokeOpacity="0.6" strokeWidth="1.2" />
        <circle cx="19" cy="30" r="3.5" fill={tint} fillOpacity="0.75" />
      </g>
    </svg>
  );
}

function AppIcon({ id, tint }) {
  if (id === 'assemblies') return <AppIconAssemblies    tint={tint} />;
  if (id === 'readiness')  return <AppIconBuildReadiness tint={tint} />;
  if (id === 'scheduler')  return <AppIconScheduler     tint={tint} />;
  if (id === 'statelogic') return <AppIconStateLogic    tint={tint} />;
  return null;
}

Object.assign(window, { AppIcon });
