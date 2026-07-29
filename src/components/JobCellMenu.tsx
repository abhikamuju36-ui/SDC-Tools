"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

// Right-click menu for the Projects grid's Job cell, replacing the two icon
// links (Job Hour Details chart + Scheduler gantt) that used to sit inside every
// row. At 40+ rows those icons were permanent clutter in the widest column and
// competed with the job-name input for space; the destinations are the same,
// just moved behind a context menu on the cell.
//
// Renders the <td> itself rather than a wrapper div so the whole cell — padding
// included — is the right-click target. A wrapper could only cover the content
// box, leaving dead strips where a right-click fell through to the browser menu.
//
// The menu is portaled to <body>, NOT rendered in place: the grid lives inside
// an `overflow: auto` scroll container (DragScroll), which clips descendants
// regardless of z-index, and the cell is a `position: sticky` frozen column
// stacking against the sticky header. Fixed-position + portal sidesteps both.
export function JobCellMenu({
  jobId,
  jobName,
  schedulerUrl,
  className,
  style,
  title,
  children,
}: {
  jobId: string;
  jobName: string;
  // Null when this job has no matching Scheduler project — the caller passes
  // jobNumbers.has(job.jobId) from getSchedulerLinkContext(), so the menu never
  // offers a dead link (same gate the old SchedulerJobLink icon used).
  schedulerUrl: string | null;
  className?: string;
  style?: CSSProperties;
  // Cell tooltip. Defaults to the job name (the Job column truncates, so the
  // full name has to stay hoverable) with the right-click hint appended, since
  // the menu replaced the visible icons that used to advertise these actions.
  title?: string;
  children: ReactNode;
}) {
  // `ret` is the report URL to hand to the Scheduler, captured when the menu
  // opens rather than at click time: window.location.href carries the user's
  // current filters/sort/columns, and mutating the anchor's href inside its own
  // click handler races React's unmount of the menu (see the close-deferral note
  // on the Scheduler link below).
  const [at, setAt] = useState<{ x: number; y: number; ret: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const cellRef = useRef<HTMLTableCellElement>(null);

  function onContextMenu(e: React.MouseEvent<HTMLTableCellElement>) {
    // Shift+right-click falls through to the browser's own menu — the cell holds
    // an editable job-name input, so keep an escape hatch to its native
    // copy/paste/spellcheck items.
    if (e.shiftKey) return;
    e.preventDefault();
    // The keyboard Menu key (and Shift+F10) fire `contextmenu` with no useful
    // coordinates; anchor to the cell instead of the viewport corner.
    const ret = window.location.href;
    if (e.clientX === 0 && e.clientY === 0) {
      const r = cellRef.current?.getBoundingClientRect();
      setAt(r ? { x: r.left + 8, y: r.bottom, ret } : { x: 0, y: 0, ret });
    } else {
      setAt({ x: e.clientX, y: e.clientY, ret });
    }
  }

  // Close on anything that would leave the menu stranded or mispositioned.
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    // `capture` so a scroll inside the grid container (which doesn't bubble)
    // still closes it.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    // mousedown, not click: a right-click elsewhere must move the menu, not
    // leave two open.
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [at]);

  // Keep it on screen: flip left/up when the cursor is near the viewport edge.
  // Layout effect so the correction paints in the same frame — a visible jump
  // would read as a glitch. Rows near the bottom of a full-height grid hit this
  // constantly.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !at) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 6;
    const x = at.x + width + pad > window.innerWidth ? Math.max(pad, at.x - width) : at.x;
    const y = at.y + height + pad > window.innerHeight ? Math.max(pad, at.y - height) : at.y;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.visibility = "visible";
    // Focus the first item so the menu is usable from the keyboard once opened.
    el.querySelector<HTMLElement>("[data-menu-item]")?.focus();
  }, [at]);

  const ITEM =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-sdc-navy hover:bg-sdc-gray-100 focus:bg-sdc-gray-100 focus:outline-none";

  return (
    <td
      ref={cellRef}
      className={className}
      style={style}
      title={title ?? `${jobName} — right-click for options`}
      onContextMenu={onContextMenu}
    >
      {children}
      {at &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Actions for ${jobName}`}
            // Positioned (and revealed) by the layout effect above, after it can
            // measure the real size — hidden until then so the pre-flip position
            // never flashes. z-index clears the sticky header (z-20) and the
            // grid's own stacking contexts.
            style={{ position: "fixed", left: at.x, top: at.y, visibility: "hidden", zIndex: 60 }}
            className="min-w-[190px] overflow-hidden rounded-md border border-sdc-border bg-white py-1 shadow-lg"
          >
            <div className="truncate border-b border-sdc-border px-3 py-1 font-mono text-[10px] text-sdc-gray-500">{jobId}</div>
            <Link href={`/job-hours?jobs=${encodeURIComponent(jobId)}`} role="menuitem" data-menu-item className={ITEM} onClick={() => setAt(null)}>
              {/* Same glyphs the removed inline icons used, so the destinations
                  stay visually recognizable. */}
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-sdc-gray-400">
                <line x1="2" y1="14" x2="14" y2="14" strokeLinecap="round" />
                <rect x="2.5" y="8" width="2.5" height="5" rx="0.5" />
                <rect x="6.75" y="4.5" width="2.5" height="8.5" rx="0.5" />
                <rect x="11" y="6.5" width="2.5" height="6.5" rx="0.5" />
              </svg>
              Job Hour Details
            </Link>
            {schedulerUrl && (
              <a
                // &ret= is what powers the Scheduler's "← Back to report"
                // button. It has to be passed explicitly: this opens in a new
                // tab (so browser Back has no entry to return to), and the
                // referrer is useless across origins — 3010 → 4003 arrives
                // stripped to the bare origin under strict-origin-when-cross-
                // origin, losing the report's path and filters.
                href={`${schedulerUrl}&ret=${encodeURIComponent(at.ret)}`}
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                data-menu-item
                className={ITEM}
                // Deferred close, unlike the Link above: setAt(null) unmounts
                // this anchor, and React flushes that synchronously for discrete
                // events — i.e. potentially before the browser performs the
                // default action, which can silently cancel the new tab. A
                // macrotask close lets the navigation start first.
                onClick={() => setTimeout(() => setAt(null), 0)}
              >
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-sdc-gray-400">
                  <line x1="2.5" y1="3.5" x2="9.5" y2="3.5" strokeLinecap="round" />
                  <line x1="5.5" y1="8" x2="13.5" y2="8" strokeLinecap="round" />
                  <line x1="3.5" y1="12.5" x2="10.5" y2="12.5" strokeLinecap="round" />
                </svg>
                Project Schedule
              </a>
            )}
          </div>,
          document.body
        )}
    </td>
  );
}
