"use client";

import { useRef, type ReactNode } from "react";

// Click-and-drag panning for a scrollable container (grab the grid and drag to
// scroll, like the Scheduler). Renders the scroll container itself, so callers
// just swap their `<div className="… overflow-auto">` for `<DragScroll className=…>`.
//
// A drag that STARTS on interactive cell content (an input, select, link, button,
// etc.) is left alone so editing/clicking still works — panning only kicks in on
// the "dead" areas of the grid (number cells, headers, gridlines). After a real
// drag, the trailing click is swallowed so it can't trigger a row click or sort.
export function DragScroll({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return; // left button only
    const target = e.target as HTMLElement;
    if (target.closest("input,select,textarea,button,a,[contenteditable],summary,label,[role='button']")) return;
    const el = ref.current;
    if (!el) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = el.scrollLeft;
    const startTop = el.scrollTop;
    moved.current = false;
    el.style.cursor = "grabbing";

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved.current && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) moved.current = true;
      el.scrollLeft = startLeft - dx;
      el.scrollTop = startTop - dy;
    };
    const onUp = () => {
      el.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Swallow the click that fires at the end of a pan so it doesn't select a
  // cell / trigger a sort. Reset the flag afterwards.
  function onClickCapture(e: React.MouseEvent) {
    if (moved.current) {
      e.stopPropagation();
      e.preventDefault();
      moved.current = false;
    }
  }

  return (
    <div ref={ref} className={className} style={{ cursor: "grab" }} onMouseDown={onMouseDown} onClickCapture={onClickCapture}>
      {children}
    </div>
  );
}
