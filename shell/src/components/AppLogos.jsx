/**
 * AppLogos — inline SVG logos sourced directly from each app's own icon assets.
 *
 * Assemblies Library  → client/public/app-icon.svg   (isometric cubes on blue gradient)
 * Build Readiness     → client/assets/favicon.svg    (Gantt bars + alert)
 * SDC Scheduler       → public/index.html brand-mark (S-knot on navy + green dot)
 * State Logic Builder → public/icon.svg              (flowchart on dark grid)
 */

export function AssembliesLogo({ size = 48 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 512 512">
      <defs>
        <clipPath id="al-clip">
          <rect x="0" y="0" width="512" height="512" rx="112" ry="112" />
        </clipPath>
        <radialGradient id="al-bg" cx="30%" cy="20%" r="100%">
          <stop offset="0%" stopColor="#2A93DD" />
          <stop offset="55%" stopColor="#1169B0" />
          <stop offset="100%" stopColor="#07375E" />
        </radialGradient>
        <linearGradient id="al-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E4F0F9" />
        </linearGradient>
        <linearGradient id="al-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C3D8E8" />
          <stop offset="100%" stopColor="#8FB0C6" />
        </linearGradient>
        <linearGradient id="al-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9DB8CB" />
          <stop offset="100%" stopColor="#5E7E95" />
        </linearGradient>
        <radialGradient id="al-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000000" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g clipPath="url(#al-clip)">
        <rect x="0" y="0" width="512" height="512" fill="url(#al-bg)" />
        <ellipse cx="256" cy="430" rx="170" ry="22" fill="url(#al-shadow)" />
        {/* Back-left cube */}
        <g transform="translate(108, 268)">
          <polygon points="0,36 72,0 144,36 72,72" fill="url(#al-top)" />
          <polygon points="0,36 72,72 72,144 0,108" fill="url(#al-left)" />
          <polygon points="72,72 144,36 144,108 72,144" fill="url(#al-right)" />
          <line x1="0" y1="36" x2="72" y2="0" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.5" />
          <line x1="72" y1="0" x2="144" y2="36" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.35" />
        </g>
        {/* Bottom-right cube */}
        <g transform="translate(260, 268)">
          <polygon points="0,36 72,0 144,36 72,72" fill="url(#al-top)" />
          <polygon points="0,36 72,72 72,144 0,108" fill="url(#al-left)" />
          <polygon points="72,72 144,36 144,108 72,144" fill="url(#al-right)" />
          <line x1="0" y1="36" x2="72" y2="0" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.5" />
          <line x1="72" y1="0" x2="144" y2="36" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.35" />
        </g>
        {/* Top cube */}
        <g transform="translate(184, 140)">
          <polygon points="0,36 72,0 144,36 72,72" fill="url(#al-top)" />
          <polygon points="0,36 72,72 72,144 0,108" fill="url(#al-left)" />
          <polygon points="72,72 144,36 144,108 72,144" fill="url(#al-right)" />
          <line x1="0" y1="36" x2="72" y2="0" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.6" />
          <line x1="72" y1="0" x2="144" y2="36" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.4" />
        </g>
        <path d="M 0 0 L 512 0 L 512 60 Q 256 140 0 60 Z" fill="#FFFFFF" opacity="0.06" />
      </g>
    </svg>
  );
}

export function ReadinessLogo({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="rl-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.22 0.02 250)" />
          <stop offset="1" stopColor="oklch(0.14 0.012 250)" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#rl-bg)" />
      <g stroke="oklch(0.45 0.02 250)" strokeWidth="2" fill="none" opacity="0.5">
        <line x1="96" y1="160" x2="416" y2="160" />
        <line x1="96" y1="226" x2="416" y2="226" />
        <line x1="96" y1="292" x2="416" y2="292" />
        <line x1="96" y1="358" x2="416" y2="358" />
      </g>
      <g>
        <rect x="120" y="148" width="220" height="24" rx="4" fill="oklch(0.78 0.16 150)" />
        <rect x="140" y="214" width="180" height="24" rx="4" fill="oklch(0.82 0.16 80)" />
        <rect x="100" y="280" width="240" height="24" rx="4" fill="oklch(0.66 0.20 25)" />
        <rect x="160" y="346" width="220" height="24" rx="4" fill="oklch(0.74 0.10 230)" />
      </g>
      <g>
        <line x1="356" y1="120" x2="356" y2="400" stroke="oklch(0.95 0.10 80)" strokeWidth="3" strokeDasharray="6 6" />
        <polygon points="346,116 366,116 356,134" fill="oklch(0.95 0.10 80)" />
      </g>
      <g transform="translate(380 116)">
        <circle r="28" fill="oklch(0.66 0.22 25)" stroke="oklch(0.20 0.04 250)" strokeWidth="4" />
        <text y="8" textAnchor="middle" fill="white" fontSize="32" fontWeight="700" fontFamily="'JetBrains Mono', monospace">!</text>
      </g>
    </svg>
  );
}

export function SchedulerLogo({ size = 48 }) {
  return (
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" width={size} height={size}>
      <rect x="0" y="0" width="40" height="40" rx="8" fill="#061d39" />
      <path
        d="M27 14c-1.6-2-4.2-3-7-3-3.4 0-6 1.6-6 4.2 0 2.4 1.8 3.6 5.6 4.4l2 .4c2 .4 2.8 1 2.8 2 0 1.4-1.4 2.2-3.6 2.2-2.4 0-4-.8-5.4-2.4L13 24.2c1.8 2.2 4.4 3.4 7.6 3.4 4.2 0 6.8-1.8 6.8-4.8 0-2.4-1.6-3.8-5.4-4.6l-2-.4c-2-.4-3-.8-3-1.8 0-1.2 1.2-2 3-2 1.8 0 3.4.6 4.6 1.8z"
        fill="#1574c4"
      />
      <circle cx="32" cy="32" r="3" fill="#74c415" />
    </svg>
  );
}

export function StateLogicLogo({ size = 48 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width={size} height={size}>
      <defs>
        <linearGradient id="sl-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1A2430" />
          <stop offset="1" stopColor="#0B0F14" />
        </linearGradient>
        <marker id="sl-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#1877BC" />
        </marker>
      </defs>
      <rect x="0" y="0" width="256" height="256" rx="56" fill="url(#sl-bg)" />
      <g opacity="0.08" stroke="white">
        <line x1="16" y1="32" x2="240" y2="32" strokeWidth="1" />
        <line x1="16" y1="64" x2="240" y2="64" strokeWidth="1" />
        <line x1="16" y1="96" x2="240" y2="96" strokeWidth="1" />
        <line x1="16" y1="128" x2="240" y2="128" strokeWidth="1" />
        <line x1="16" y1="160" x2="240" y2="160" strokeWidth="1" />
        <line x1="16" y1="192" x2="240" y2="192" strokeWidth="1" />
        <line x1="16" y1="224" x2="240" y2="224" strokeWidth="1" />
        <line x1="32" y1="16" x2="32" y2="240" strokeWidth="1" />
        <line x1="64" y1="16" x2="64" y2="240" strokeWidth="1" />
        <line x1="96" y1="16" x2="96" y2="240" strokeWidth="1" />
        <line x1="128" y1="16" x2="128" y2="240" strokeWidth="1" />
        <line x1="160" y1="16" x2="160" y2="240" strokeWidth="1" />
        <line x1="192" y1="16" x2="192" y2="240" strokeWidth="1" />
        <line x1="224" y1="16" x2="224" y2="240" strokeWidth="1" />
      </g>
      <rect x="4" y="4" width="248" height="248" rx="54" fill="none" stroke="white" strokeOpacity="0.06" strokeWidth="2" />
      <line x1="64" y1="74" x2="110" y2="118" stroke="#1877BC" strokeWidth="8" strokeLinecap="round" markerEnd="url(#sl-arr)" />
      <line x1="146" y1="118" x2="192" y2="74" stroke="#1877BC" strokeWidth="8" strokeLinecap="round" markerEnd="url(#sl-arr)" />
      <line x1="128" y1="150" x2="128" y2="186" stroke="#1877BC" strokeWidth="8" strokeLinecap="round" markerEnd="url(#sl-arr)" />
      <circle cx="56" cy="66" r="20" fill="white" />
      <rect x="104" y="104" width="48" height="48" rx="4" transform="rotate(45 128 128)" fill="#1877BC" />
      <circle cx="200" cy="66" r="26" fill="none" stroke="#22D3EE" strokeWidth="3" opacity="0.9" />
      <circle cx="200" cy="66" r="20" fill="#22D3EE" />
      <circle cx="128" cy="196" r="20" fill="white" />
    </svg>
  );
}

export function CalendarLogo({ size = 48 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 512 512">
      <rect width="512" height="512" rx="112" fill="#061D39" />
      {/* Header bar */}
      <rect x="72" y="88" width="368" height="88" rx="14" fill="#1574C4" />
      {/* Ring pins */}
      <rect x="168" y="56" width="22" height="60" rx="11" fill="#AACEE8" />
      <rect x="322" y="56" width="22" height="60" rx="11" fill="#AACEE8" />
      {/* Month label placeholder */}
      <rect x="116" y="112" width="140" height="16" rx="6" fill="rgba(255,255,255,0.85)" />
      {/* Nav arrows */}
      <polygon points="390,120 406,108 406,132" fill="rgba(255,255,255,0.7)" />
      <polygon points="430,120 414,108 414,132" fill="rgba(255,255,255,0.7)" />
      {/* Calendar body */}
      <rect x="72" y="176" width="368" height="276" rx="0" fill="rgba(255,255,255,0.04)" />
      <rect x="72" y="440" width="368" height="12" rx="0" fill="rgba(255,255,255,0.04)" />
      {/* Row grid lines */}
      <line x1="72"  y1="230" x2="440" y2="230" stroke="#AACEE8" strokeWidth="1.5" opacity="0.2" />
      <line x1="72"  y1="284" x2="440" y2="284" stroke="#AACEE8" strokeWidth="1.5" opacity="0.2" />
      <line x1="72"  y1="338" x2="440" y2="338" stroke="#AACEE8" strokeWidth="1.5" opacity="0.2" />
      <line x1="72"  y1="392" x2="440" y2="392" stroke="#AACEE8" strokeWidth="1.5" opacity="0.2" />
      {/* Column grid lines (6 cols) */}
      <line x1="125" y1="176" x2="125" y2="452" stroke="#AACEE8" strokeWidth="1.5" opacity="0.15" />
      <line x1="178" y1="176" x2="178" y2="452" stroke="#AACEE8" strokeWidth="1.5" opacity="0.15" />
      <line x1="231" y1="176" x2="231" y2="452" stroke="#AACEE8" strokeWidth="1.5" opacity="0.15" />
      <line x1="284" y1="176" x2="284" y2="452" stroke="#AACEE8" strokeWidth="1.5" opacity="0.15" />
      <line x1="337" y1="176" x2="337" y2="452" stroke="#AACEE8" strokeWidth="1.5" opacity="0.15" />
      <line x1="390" y1="176" x2="390" y2="452" stroke="#AACEE8" strokeWidth="1.5" opacity="0.15" />
      {/* Day header row */}
      <rect x="80"  y="182" width="38" height="38" fill="rgba(170,206,232,0.12)" />
      <rect x="133" y="182" width="38" height="38" fill="rgba(170,206,232,0.12)" />
      <rect x="186" y="182" width="38" height="38" fill="rgba(170,206,232,0.12)" />
      <rect x="239" y="182" width="38" height="38" fill="rgba(170,206,232,0.12)" />
      <rect x="292" y="182" width="38" height="38" fill="rgba(170,206,232,0.12)" />
      <rect x="345" y="182" width="38" height="38" fill="rgba(170,206,232,0.12)" />
      <rect x="398" y="182" width="38" height="38" fill="rgba(170,206,232,0.12)" />
      {/* Today highlight cell */}
      <rect x="239" y="236" width="38" height="42" rx="8" fill="#FFDE51" />
      <text x="258" y="264" textAnchor="middle" fill="#061D39" fontSize="20" fontWeight="800" fontFamily="Montserrat,Arial,sans-serif">15</text>
      {/* Event dots */}
      <circle cx="99"  cy="275" r="7" fill="#74C415" />
      <circle cx="152" cy="329" r="7" fill="#1574C4" />
      <circle cx="311" cy="275" r="7" fill="#BEFA4F" />
      <circle cx="364" cy="329" r="7" fill="#74C415" />
      <circle cx="99"  cy="383" r="7" fill="#FFDE51" />
      <circle cx="417" cy="383" r="7" fill="#1574C4" />
    </svg>
  );
}

const LOGOS = {
  assemblies: AssembliesLogo,
  readiness:  ReadinessLogo,
  scheduler:  SchedulerLogo,
  statelogic: StateLogicLogo,
  calendar:   CalendarLogo,
};

/** Returns the correct logo component for a given app id, or null. */
export default function AppLogo({ appId, size = 48 }) {
  const Logo = LOGOS[appId];
  return Logo ? <Logo size={size} /> : null;
}
