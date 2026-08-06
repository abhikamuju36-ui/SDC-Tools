"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";

// ── One consistent hover/tap tooltip for the hand-rolled dashboard charts (§59) ─
//
// The ECharts charts (Quoted/Actual by Billing Group) use ECharts' own tooltip,
// styled to match this box in charts/theme.ts; the Estimate-to-Complete chart
// has its own inline tooltip of the same visual language (kept because it also
// drives that chart's hover-dimming). This is the shared box for everything
// else — the Parts Cost bar and the Projection-vs-Estimated meter — so those
// stop relying on the browser's slow, unstyled `title` popup.
//
// Rendered through a PORTAL to <body>, which is what makes it satisfy §59's
// interaction rules structurally rather than by luck:
//   • never clipped by a card's overflow / rounded corners (it isn't inside one)
//   • never hidden behind another element (last in the DOM, high z-index)
//   • `pointer-events-none`, so it can never block a click, a drill, or a hover
//   • `position: fixed` at the pointer and clamped to the viewport, so it
//     follows the cursor, stays on screen, and never shifts the chart it describes.

export type TooltipRow = {
  /** Swatch colour tying the row to its chart series. Omit for a plain row. */
  color?: string;
  label: string;
  value: string;
  /** Emphasise (e.g. the Difference line). */
  strong?: boolean;
  /** Colour the value text (e.g. red over / green under). */
  valueColor?: string;
};

export type TooltipData = {
  title: string;
  /** Secondary line under the title, e.g. "Selected job" or "Phase · Dept". */
  sub?: string;
  rows: TooltipRow[];
};

const OFFSET = 14;
// Rough box size, only used to decide when to flip near a viewport edge.
const EST_W = 220;
const EST_H = 132;
const INK = "#12239e"; // sdc-navy, matching the ECharts tooltip value colour

export function useChartTooltip() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [data, setData] = useState<TooltipData | null>(null);

  const close = useCallback(() => {
    setPos(null);
    setData(null);
  }, []);

  /**
   * Spread the return value onto any hoverable/tappable chart element:
   *   <div {...trigger(tooltipData)} />
   * Mouse hover shows and follows; a touch/pen tap toggles it (§59 touch rule).
   * Mouse clicks are deliberately NOT bound, so an element that also drills on
   * click keeps working.
   */
  const trigger = useCallback(
    (d: TooltipData) => ({
      onMouseEnter: (e: React.MouseEvent) => {
        setData(d);
        setPos({ x: e.clientX, y: e.clientY });
      },
      onMouseMove: (e: React.MouseEvent) => {
        setPos((p) => (p ? { x: e.clientX, y: e.clientY } : p));
      },
      onMouseLeave: () => close(),
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === "mouse") return; // mouse uses hover, above
        setData((cur) => {
          if (cur) {
            setPos(null);
            return null;
          }
          setPos({ x: e.clientX, y: e.clientY });
          return d;
        });
      },
    }),
    [close],
  );

  const node = pos && data ? <ChartTooltipBox x={pos.x} y={pos.y} data={data} /> : null;

  return { trigger, close, node };
}

function ChartTooltipBox({ x, y, data }: { x: number; y: number; data: TooltipData }) {
  // No SSR/hydration gate needed: this only ever renders because `pos`/`data`
  // in useChartTooltip() were just set by a mouse or touch event handler —
  // and no such event fires during a server render — so `document`/`window`
  // are always available by the time this function body runs.
  let left = x + OFFSET;
  let top = y + OFFSET;
  if (left + EST_W > window.innerWidth) left = x - OFFSET - EST_W;
  if (top + EST_H > window.innerHeight) top = y - OFFSET - EST_H;
  left = Math.max(4, left);
  top = Math.max(4, top);

  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[100] max-w-[240px] rounded-md border border-sdc-border bg-white px-3 py-2 text-xs shadow-lg"
      style={{ left, top }}
    >
      <div className="font-semibold text-sdc-navy">{data.title}</div>
      {data.sub && <div className="mt-0.5 text-label text-sdc-muted">{data.sub}</div>}
      <div className="mt-1 space-y-0.5">
        {data.rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-sdc-gray-600">
              {r.color && <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: r.color }} />}
              {r.label}
            </span>
            <span className={`tabular-nums ${r.strong ? "font-bold" : "font-medium"}`} style={{ color: r.valueColor ?? INK }}>
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
