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
//   picker (GridDateCells calls showPicker on mousedown), links/buttons/summaries act.
//
//   PAN from a text or number input that is NOT currently focused. So the first
//   press on a cell pans, and once you are actually editing that cell, dragging
//   inside it selects text as usual.
//
// ── The first click focuses the cell again (§38.1, 2026-08-04) ───────────────
//
// This used to call preventDefault() on every mousedown over an unfocused cell input,
// to stop a pan-that-turned-out-to-be-a-click from dropping a caret into live data.
// The cost of that was the first symptom §38 reports: a single click on a cell did
// NOTHING VISIBLE. Focus is this grid's only selection model — the input IS the cell —
// so suppressing focus suppressed selection, and the user had to click again (or
// double-click) to get anywhere. §38.1 forbids exactly that ("the first click must
// never be ignored"), and §38.16 #3 asks for the opposite behaviour outright.
//
// The gesture is separated by MOVEMENT instead of by click count, which is what
// actually distinguishes a pan from a click:
//
//   press, don't move  -> the browser focuses the cell. It is selected, immediately.
//   press, move >3px   -> blur, drop the text selection, and pan.
//
// A caret in a cell is not an edit — nothing is written until a value changes — and it
// is exactly what "selecting a cell" looks like on a grid whose cells are inputs.
// Double-click still selects the whole value, as a spreadsheet does.
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

/**
 * What a mousedown on this grid means. Pure, and exported, because getting it wrong in
 * either direction is a reported bug: too eager and a `<select>` never opens or a
 * focused cell cannot be text-selected, too shy and the grid stops panning.
 *
 *   "ignore"  — not ours: a control whose mousedown IS the interaction, or a grid with
 *               nothing to scroll.
 *   "editing" — a text input that already has focus. Leave the press completely alone
 *               so selecting inside the value still works.
 *   "pan"     — anything else. Track for movement; the browser is left to do its own
 *               focusing, so a press that never moves is a plain click on a cell.
 *
 * The §34.2 stale-border rule that used to live here is GONE, along with the
 * preventDefault that made it necessary: focus now transfers the way the browser
 * transfers it, so no cell can be left outlined after the pointer has moved on.
 */
export type PressKind = "ignore" | "editing" | "pan";

export function pressKindFor(opts: {
  neverPan: boolean;
  scrollable: boolean;
  isTextish: boolean;
  alreadyFocused: boolean;
}): PressKind {
  if (opts.neverPan) return "ignore";
  if (!opts.scrollable) return "ignore";
  if (opts.isTextish && opts.alreadyFocused) return "editing";
  return "pan";
}

export function DragScroll({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

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
    const el = ref.current;
    if (!el) return;

    const textish = target.closest("input,textarea") as HTMLElement | null;
    const kind = pressKindFor({
      neverPan: target.closest(NEVER_PAN) !== null,
      scrollable: scrollable(el),
      isTextish: textish !== null,
      alreadyFocused: textish !== null && document.activeElement === textish,
    });
    if (kind !== "pan") return;

    // ── No preventDefault (§38.1, §38.5) ────────────────────────────────────
    //
    // The press is left entirely alone, so the browser focuses the cell itself and
    // the click registers on the FIRST press. Everything below only watches for
    // movement; nothing here delays or suppresses the interaction.
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = el.scrollLeft;
    const startTop = el.scrollTop;
    moved.current = false;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved.current) {
        if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return; // still a click, not a pan
        moved.current = true;
        // NOW it is a pan: take focus off the cell the press landed in and drop the
        // text selection the browser started, so dragging scrolls the grid instead of
        // sweeping a selection through a value. Doing it here rather than on mousedown
        // is the whole fix — on mousedown it also cancelled the click.
        el.style.cursor = "grabbing";
        if (document.activeElement instanceof HTMLElement && el.contains(document.activeElement)) {
          document.activeElement.blur();
        }
        window.getSelection()?.removeAllRanges();
      }
      el.scrollLeft = startLeft - dx;
      el.scrollTop = startTop - dy;
    };
    const onUp = () => {
      el.style.cursor = scrollable(el) ? "grab" : "";
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

  // Double-click SELECTS THE WHOLE VALUE, the way a spreadsheet does. It is no longer
  // what focuses the cell — the single click does that now (see onMouseDown) — so this
  // is the "replace this value" gesture rather than the only way in, and it matches the
  // select-all ExcelCellFocus gives a cell reached by keyboard.
  function onDoubleClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const textish = target.closest("input,textarea") as HTMLInputElement | HTMLTextAreaElement | null;
    if (!textish || textish.disabled || textish.readOnly) return;
    textish.focus();
    if (textish instanceof HTMLInputElement && textish.type !== "date") textish.select();
  }

  return (
    <div
      ref={ref}
      className={className}
      onMouseEnter={onMouseEnter}
      onMouseDown={onMouseDown}
      onClickCapture={onClickCapture}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </div>
  );
}
