"use client";

import { useEffect, useState } from "react";

// App-wide text size. Sets the root <html> font-size in px; because Tailwind's
// type + spacing scale is rem-based, this scales the whole UI proportionally
// (headers and body stay in proportion). Persisted to localStorage and restored
// before paint by the inline script in the root layout (no flash on reload).
const KEY = "app-font-px";
const MIN = 12;
const MAX = 20;
const DEFAULT = 15; // slightly compact but readable
const STEP = 1;

function clamp(n: number): number {
  return Math.min(MAX, Math.max(MIN, Number.isFinite(n) ? n : DEFAULT));
}

export function AppTextSize({ collapsed }: { collapsed?: boolean }) {
  const [px, setPx] = useState(DEFAULT);

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY);
    const v = clamp(saved != null ? parseFloat(saved) : DEFAULT);
    setPx(v);
    document.documentElement.style.fontSize = `${v}px`;
    if (saved == null) window.localStorage.setItem(KEY, String(v));
  }, []);

  const apply = (v: number) => {
    const c = clamp(v);
    setPx(c);
    document.documentElement.style.fontSize = `${c}px`;
    window.localStorage.setItem(KEY, String(c));
  };

  // Dark navy sidebar styling (#061D39 panel — see Sidebar.tsx). The enclosing
  // footer block owns the border and padding now, so this row is just the label
  // + stepper.
  const btn =
    "flex h-5 w-5 items-center justify-center rounded-[5px] bg-[#0B2846] text-sm leading-none text-[#A9BCD0] shadow-[inset_0_0_0_1px_#17395C] hover:bg-[#0E3157] disabled:opacity-40";

  if (collapsed) return null;

  return (
    <div className="flex h-[34px] items-center justify-between gap-2 px-[10px]">
      <span className="text-xs text-[#7E93AC]">Text size</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => apply(px - STEP)} disabled={px <= MIN} className={btn} aria-label="Decrease text size">−</button>
        <span className="min-w-[18px] text-center font-mono text-note tabular-nums text-[#C3D1E0]">{px}</span>
        <button type="button" onClick={() => apply(px + STEP)} disabled={px >= MAX} className={btn} aria-label="Increase text size">+</button>
      </div>
    </div>
  );
}
