"use client";

import { useRef, type ReactNode } from "react";

// Click-and-drag panning for a scrollable container (grab the grid and drag to
// scroll, like the Scheduler). Renders the scroll container itself, so callers
// just swap their `<div className="… overflow-auto">` for `<DragScroll className=…>`.
//
// ── Why this is more than "ignore interactive elements" ──────────────────────
// It used to bail on any mousedown inside an input/select/link/button, so panning
// only worked on the "dead" parts of a grid. On the Projects grid there are almost
// none: every cell holds an input or a dropdown — job name, customer, type,
// billable, status, both dates, thirteen section-hour cells, two money cells — so
// dragging did nothing almost everywhere, which is exactly how it was reported.
//
// The rule now distinguishes two kinds of interactive content:
//
//   NEVER pan from these — the mousedown IS the interaction, and suppressing it
//   would break them: a <select> must open its dropdown, a date input opens its
//   picker (DateCell calls showPicker on mousedown), links/buttons/summaries act.
//
//   PAN from a text or number input that is NOT currently focused, and restore the
//   click if the pointer never moved. So the first press on a cell pans, and once
//   you are actually editing that cell, dragging inside it selects text as usual.
//   Focus is suppressed during the press and re-applied on release only when it
//   was a click rather than a drag — otherwise panning would leave a caret blinking
//   in whatever cell you happened to grab, and would drag-select its text.
const NEVER_PAN = [
  "select",
  "button",
  "a",
  "summary",
  "label",
  "[contenteditable]",
  "[role='button']",
  "input[type='date']",
  "input[type='checkbox']",
  "input[type='radio']",
].join(",");

export function DragScroll({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  // The input whose focus we suppressed, to hand back if this turns out to be a
  // click and not a pan.
  const pendingFocus = useRef<HTMLElement | null>(null);

  const scrollable = (el: HTMLElement) => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;

  // Only show the grab cursor when there's actually something to pan, so
  // non-overflowing tables don't get a misleading "grab" affordance.
  function onMouseEnter() {
    const el = ref.current;
    if (el) el.style.cursor = scrollable(el) ? "grab" : "";
  }

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return; // left button only
    const target = e.target as HTMLElement;
    if (target.closest(NEVER_PAN)) return;

    const el = ref.current;
    if (!el || !scrollable(el)) return;

    // A text/number input that already has focus is being edited — leave the
    // press alone so selecting inside it still works.
    const textish = target.closest("input,textarea") as HTMLElement | null;
    if (textish && document.activeElement === textish) return;

    pendingFocus.current = null;
    if (textish) {
      // Suppress the focus and the drag-select that would otherwise come with
      // this press; handed back on release if nothing moved.
      e.preventDefault();
      pendingFocus.current = textish;
    }

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
      // Not a drag after all: give the cell the focus its click would have.
      if (!moved.current && pendingFocus.current) pendingFocus.current.focus();
      pendingFocus.current = null;
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
    <div ref={ref} className={className} onMouseEnter={onMouseEnter} onMouseDown={onMouseDown} onClickCapture={onClickCapture}>
      {children}
    </div>
  );
}
