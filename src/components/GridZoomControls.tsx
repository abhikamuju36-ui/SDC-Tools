"use client";


// Density controls for a data grid — "Row height" scales every body cell's
// vertical padding, "Column width" scales the grid's repeated data columns'
// horizontal padding (frozen/sticky columns and one-off metadata columns keep
// their own fixed widths — each page's own `:not(sticky)`/marker-class guard
// on its table decides exactly which cells listen). Shared by the Monthly ETC
// grid and the Projects grid, each with its own CSS var names/localStorage
// keys so their densities are independent.
//
// Both are plain CSS custom properties set on the document root, so they
// survive a grid's own remounts (e.g. ETC's key={month}) without any extra
// wiring — a freshly mounted table just inherits whatever's already on
// :root. No React state involved (same pattern as ColumnResize.tsx) — the
// CSS variable itself is the only source of truth, read straight off the DOM
// on every click, so there's nothing to fall out of sync. Persisted to
// localStorage so a chosen density survives a reload.
const MIN_PX = 0;
const MAX_PX = 16;
const STEP_PX = 2;

function clamp(n: number): number {
  return Math.min(MAX_PX, Math.max(MIN_PX, n));
}

function currentValue(cssVar: string, defaultPx: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  const n = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(n) ? n : defaultPx;
}

function step(cssVar: string, storageKey: string, defaultPx: number, delta: number) {
  const next = clamp(currentValue(cssVar, defaultPx) + delta);
  document.documentElement.style.setProperty(cssVar, `${next}px`);
  window.localStorage.setItem(storageKey, String(next));
}

// The steppers, for a menu that already has its own popover to host them —
// currently the Projects toolbar's bucketed "Display". The self-contained
// dropdown version that used to live here went with the un-bucketed toolbar;
// nothing rendered it any more.
//
// The mount-time localStorage restore is the CALLER's job (see
// ProjectsDisplayMenu): it has to run whether or not the menu is ever opened,
// so it belongs in something always rendered, which this popover body isn't.
export function GridZoomBody({
  rowVar,
  colVar,
  rowStorageKey,
  colStorageKey,
  defaultRowPx,
  defaultColPx,
}: {
  rowVar: string;
  colVar: string;
  rowStorageKey: string;
  colStorageKey: string;
  defaultRowPx: number;
  defaultColPx: number;
}) {
  return (
    <>
      <ZoomStepper
        label="Row height"
        onDecrease={() => step(rowVar, rowStorageKey, defaultRowPx, -STEP_PX)}
        onIncrease={() => step(rowVar, rowStorageKey, defaultRowPx, STEP_PX)}
      />
      <ZoomStepper
        label="Column width"
        onDecrease={() => step(colVar, colStorageKey, defaultColPx, -STEP_PX)}
        onIncrease={() => step(colVar, colStorageKey, defaultColPx, STEP_PX)}
      />
    </>
  );
}

function ZoomStepper({ label, onDecrease, onIncrease }: { label: string; onDecrease: () => void; onIncrease: () => void }) {
  const btn =
    "flex h-6 w-6 items-center justify-center rounded border border-sdc-border bg-white font-semibold leading-none text-sdc-navy hover:bg-sdc-blue-light";
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onDecrease} className={btn} aria-label={`Decrease ${label.toLowerCase()}`} title={`Decrease ${label.toLowerCase()}`}>
          −
        </button>
        <button type="button" onClick={onIncrease} className={btn} aria-label={`Increase ${label.toLowerCase()}`} title={`Increase ${label.toLowerCase()}`}>
          +
        </button>
      </div>
    </div>
  );
}
