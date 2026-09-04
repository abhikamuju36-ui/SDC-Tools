"use client";

import { useLayoutEffect, useRef } from "react";
import {
  ROOT_KEY,
  applyScrollState,
  elementForKey,
  parseScrollState,
  pruneScrollState,
  scrollKeyOf,
  tabScrollStorageKey,
  type TabScrollState,
} from "@/lib/tab-scroll-state";

// ── The pane's scroll container, and every scroller inside it ────────────────
//
// lib/tab-scroll-state.ts carries the whole reasoning: why <Activity> alone does not
// keep a nested scroller's offset (`display: none` removes the layout box, so there is
// no scroll box to keep), why positions are recorded as they change rather than read on
// the way out, and why the store is keyed by TAB INSTANCE.
//
// What lives here is the wiring: one capture-phase listener per pane, and a restore
// that keeps trying until the offsets actually stick.

/** Give up after this many frames. ~20 at 60fps is a third of a second. */
const MAX_RESTORE_FRAMES = 20;

export function TabScrollMemory({ tabId, children }: { tabId: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // The live record. A ref rather than state: nothing renders from it, and a setState
  // per scroll frame on a 450-cell grid would be its own performance bug.
  const state = useRef<TabScrollState>({});
  const loaded = useRef(false);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const storageKey = tabScrollStorageKey(tabId);

    // ── Seed from the last session, once ──────────────────────────────────
    //
    // Only on the first mount for this tab. On a re-show the in-memory record is the
    // authority — it is newer than anything on disk, and re-reading storage here would
    // undo a position the user changed since the last frame that got persisted.
    if (!loaded.current) {
      loaded.current = true;
      try {
        state.current = parseScrollState(sessionStorage.getItem(storageKey));
      } catch {
        // Private mode, or storage disabled. Starting at the top is a fine outcome.
      }
    }

    // ── Restore, and keep trying until it takes ───────────────────────────
    //
    // A layout effect is the earliest point the pane is laid out again, but "laid out"
    // is not the same as "the table inside has its final width": a Monthly ETC grid
    // whose columns have not been measured yet clamps scrollLeft to 0 and reports 0
    // back, which is the silent failure the report warned about. So each frame reapplies
    // only the entries that have not stuck, and stops as soon as none are left.
    let frame = 0;
    let raf = 0;
    const restore = () => {
      const pending = applyScrollState(root, state.current);
      if (pending.length === 0 || frame >= MAX_RESTORE_FRAMES) return;
      frame++;
      raf = requestAnimationFrame(restore);
    };
    restore();

    // ── Record ────────────────────────────────────────────────────────────
    //
    // Capture phase: a scroll event does not bubble, but it does reach a capture
    // listener on an ancestor — so this one listener sees the pane itself AND every
    // scroller nested anywhere inside it. That is what makes this general across all
    // twelve pages rather than a Monthly ETC special case.
    let writeRaf = 0;
    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !root.contains(el)) return;
      const key = el === root ? ROOT_KEY : scrollKeyOf(el, root);
      state.current[key] = { left: el.scrollLeft, top: el.scrollTop };
      // One write per frame at most: a trackpad fling on a long grid fires these in the
      // hundreds, and sessionStorage is synchronous.
      if (writeRaf) return;
      writeRaf = requestAnimationFrame(() => {
        writeRaf = 0;
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(pruneScrollState(state.current)));
        } catch {
          /* see above */
        }
      });
    };
    root.addEventListener("scroll", onScroll, { capture: true, passive: true });

    return () => {
      root.removeEventListener("scroll", onScroll, { capture: true });
      if (raf) cancelAnimationFrame(raf);
      if (writeRaf) cancelAnimationFrame(writeRaf);
      // A last read on the way out, for anything that scrolled in the frame the pane was
      // hidden. Belt-and-braces: the listener above has almost certainly already
      // recorded it, and this cannot be RELIED on — if React has already applied
      // display:none then every offset here reads 0, which is why it only ever ADDS
      // non-zero values and never overwrites a remembered one with a zero.
      // `root`, captured when the effect ran — not ref.current, which React may have
      // already detached by the time a cleanup runs.
      if (root.isConnected) {
        for (const key of Object.keys(state.current)) {
          const node = elementForKey(root, key);
          if (!node) continue;
          if (node.scrollLeft !== 0 || node.scrollTop !== 0) {
            state.current[key] = { left: node.scrollLeft, top: node.scrollTop };
          }
        }
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(pruneScrollState(state.current)));
        } catch {
          /* see above */
        }
      }
    };
  }, [tabId]);

  // overflow-auto both ways: dense pages scroll horizontally in here too, and
  // ScrollHandoff (mounted once in AppShell, above this) keeps nested table scrolling
  // working because it listens at the document level.
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-auto bg-background">
      {children}
    </div>
  );
}
