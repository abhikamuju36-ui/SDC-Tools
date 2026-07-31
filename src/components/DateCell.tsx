"use client";

import { useState } from "react";

// Native <input type="date"> shows literal "mm/dd/yyyy" segments when empty,
// which reads as noisy placeholder clutter across a whole column of blank
// dates. Hiding those segments (via the .date-empty rule in globals.css)
// leaves the cell clean until a real date is picked — tracked with local state
// (not a CSS-only trick) so a freshly-picked date shows immediately without
// waiting for the page to re-render from the server.
//
// Clicking the cell opens the calendar directly, the way the Type/Billable/
// Status cells open their dropdown on click. Before this, the only way in was
// the native calendar icon — which the grid hides until hover, so users were
// widening the column hunting for it. The icon is gone entirely now (see
// globals.css); the whole cell is the affordance.
export function DateCell({
  name,
  defaultValue,
  ariaLabel,
}: {
  name: string;
  defaultValue: string;
  ariaLabel: string;
}) {
  const [empty, setEmpty] = useState(defaultValue === "");
  // showPicker() must run inside a user gesture and throws if the browser
  // won't oblige (unsupported, or already open) — swallow that rather than
  // break the click, since the input is still perfectly typeable either way.
  const openPicker = (el: HTMLInputElement) => {
    try {
      el.showPicker();
    } catch {
      /* keyboard entry still works */
    }
  };
  return (
    <input
      type="date"
      name={name}
      defaultValue={defaultValue}
      // The server's value, for dirty-form.ts: this cell is submitted only when
      // the picked date differs from it.
      data-baseline={defaultValue}
      aria-label={ariaLabel}
      className={empty ? "date-empty" : undefined}
      // onMouseDown, not onClick: mousedown is what focuses a date segment, so
      // opening here means one click gets the calendar instead of one click to
      // land on a segment and another to open anything.
      onMouseDown={(e) => {
        // Left button only — right-click belongs to the browser's own menu.
        if (e.button !== 0) return;
        e.preventDefault(); // don't put the caret in a date segment first
        e.currentTarget.focus();
        openPicker(e.currentTarget);
      }}
      // Keyboard parity: Enter/Space on a focused cell opens the same calendar.
      // Arrows and digits are left alone so typing a date still works.
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        openPicker(e.currentTarget);
      }}
      onChange={(e) => setEmpty(e.target.value === "")}
    />
  );
}
