// Shared class-string vocabulary — every page draws cards, buttons, inputs, and
// table headers from here instead of hand-rolling the same Tailwind strings.

export const CARD_BASE = "rounded-xl border border-sdc-border bg-white shadow-sm transition-shadow";

export function card(padding: string = "p-5"): string {
  return `${CARD_BASE} ${padding}`;
}

export const BUTTON_PRIMARY =
  "rounded-lg bg-sdc-blue px-5 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(21,116,196,0.25),0_4px_10px_rgba(21,116,196,0.18)] transition-all hover:bg-sdc-blue-dark hover:shadow-[0_2px_4px_rgba(21,116,196,0.3),0_6px_14px_rgba(21,116,196,0.22)] active:translate-y-px active:shadow-[0_1px_2px_rgba(21,116,196,0.25)] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0";

export const BUTTON_SECONDARY =
  "rounded-lg border border-sdc-border bg-white px-5 py-2.5 text-sm font-semibold text-sdc-navy shadow-sm transition-all hover:border-sdc-blue-100 hover:bg-sdc-blue-light hover:shadow-md active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50";

// Compact primary — the toolbar/inline size (was hand-rolled as
// `bg-sdc-blue px-3 py-1.5` in a dozen places with no shadow/press feedback).
export const BUTTON_PRIMARY_SM =
  "rounded-md bg-sdc-blue px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-sdc-blue-dark active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0";

// Ghost / tertiary — bordered white, for secondary toolbar actions and the
// dropdown triggers (matches the ColumnToggle/GridZoomControls trigger style).
export const BUTTON_GHOST =
  "rounded-md border border-sdc-border bg-white px-3.5 py-1.5 text-sm font-medium text-sdc-navy shadow-sm transition-colors hover:bg-sdc-blue-light disabled:cursor-not-allowed disabled:opacity-50";

// Danger — destructive actions (deactivate, delete, remove). Uses the red
// tokens so it stops drifting shade-to-shade across files.
export const BUTTON_DANGER =
  "rounded-md border border-sdc-red-border bg-white px-3 py-1.5 text-sm font-semibold text-sdc-red-text shadow-sm transition-colors hover:bg-sdc-red-bg disabled:cursor-not-allowed disabled:opacity-50";

// One consistent shape/size for EVERY control in the Projects toolbar — filter
// pills, Actuals, Columns, Grid Size, Views. Geometry only (fixed height, same
// radius/padding/font/border/shadow); callers append one color variant below so
// they line up evenly regardless of state.
export const TOOLBAR_BTN =
  "flex list-none cursor-pointer select-none items-center gap-1.5 rounded-lg border px-3.5 h-9 text-sm font-medium shadow-sm transition-colors";
// Neutral (menus with no on/off state), Active (a filter/toggle that's engaged),
// Muted (a filter with nothing selected).
export const TOOLBAR_BTN_NEUTRAL = "border-sdc-border bg-white text-sdc-navy hover:bg-sdc-blue-light";
export const TOOLBAR_BTN_ACTIVE = "border-sdc-blue bg-sdc-blue-light text-sdc-blue-dark";
export const TOOLBAR_BTN_MUTED = "border-sdc-border bg-white text-sdc-gray-500 hover:bg-sdc-blue-light";

export const INPUT =
  "rounded-lg border border-sdc-border bg-white px-3.5 py-2.5 text-sm text-sdc-navy shadow-sm transition-shadow outline-none focus:border-sdc-blue focus:ring-2 focus:ring-sdc-blue/15";

export const LABEL = "text-[13px] font-semibold text-sdc-navy";

// Bottom-border only, no flat gray fill band — reads closer to a considered
// spreadsheet/ledger header than a generic admin-template table.
export const TABLE_HEADER_ROW =
  "border-b-2 border-sdc-border text-center text-[10px] font-semibold uppercase tracking-wider text-sdc-gray-600";

export const TABLE_ROW_HOVER = "transition-colors hover:bg-sdc-blue-light/40";

// Full gridlines + tabular-width numerals — makes data tables read like a
// spreadsheet grid (what finance/PM reviewers expect) instead of a generic
// borderless admin-table list.
// border-separate (not collapse) is load-bearing: collapsed borders belong to
// the shared grid edges on the scrolling layer, so sticky cells pin in place
// while their borders scroll away — ghost gridlines float over the frozen
// columns/headers. With separate borders each cell owns its bottom+left edge
// and they travel with the cell; border-spacing-0 keeps the grid seamless.
export const TABLE_GRID =
  "border-separate border-spacing-0 [&_th]:border-b [&_th]:border-l [&_th]:border-[#808080] [&_td]:border-b [&_td]:border-l [&_td]:border-[#808080] [&_td]:tabular-nums [&_td]:font-semibold";

// Table wrapper — sharp corners (not CARD_BASE's rounded-xl) so the grid's
// straight gridlines run flush to the container edge, like a real spreadsheet.
export const TABLE_CARD = "overflow-hidden border border-sdc-border bg-white shadow-sm";
