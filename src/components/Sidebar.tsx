"use client";

import Image from "next/image";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  applyNavOrder,
  moveItem,
  readNavOrder,
  subscribeNavOrder,
  writeNavOrder,
  clearNavOrder,
  NO_NAV_ORDER,
} from "@/lib/nav-order";
import { appVersionLabel } from "@/lib/app-version";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isEtcDirty } from "@/lib/etc-dirty-tracker";
import { RefreshDataButton } from "@/components/RefreshDataButton";
import { AppTextSize } from "@/components/AppTextSize";

const COLLAPSE_KEY = "sdc-etc-planner-sidebar-collapsed";
const WIDTH_KEY = "sdc-etc-planner-sidebar-width";
const DEFAULT_WIDTH = 276; // the Porcelain design's sidebar width (was 240)
const MIN_WIDTH = 180;
const MAX_WIDTH = 420;

// Minimal external store for the collapse toggle. Avoids setState-in-effect
// (which would cause a hydration mismatch anyway, since localStorage isn't
// available during SSR) — useSyncExternalStore is the correct primitive for
// syncing a browser-only value into React with a safe server snapshot.
let collapsedValue = false;
let initialized = false;
const listeners = new Set<() => void>();

function getSnapshot() {
  if (!initialized) {
    collapsedValue = window.localStorage.getItem(COLLAPSE_KEY) === "1";
    initialized = true;
  }
  return collapsedValue;
}

function getServerSnapshot() {
  return false;
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function setCollapsedValue(next: boolean) {
  collapsedValue = next;
  initialized = true;
  window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
  listeners.forEach((cb) => cb());
}

// Same external-store pattern as the collapse toggle, for the drag-resized width.
let widthValue = DEFAULT_WIDTH;
let widthInitialized = false;
const widthListeners = new Set<() => void>();

function getWidthSnapshot() {
  if (!widthInitialized) {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY));
    widthValue = stored >= MIN_WIDTH && stored <= MAX_WIDTH ? stored : DEFAULT_WIDTH;
    widthInitialized = true;
  }
  return widthValue;
}

function getServerWidthSnapshot() {
  return DEFAULT_WIDTH;
}

function subscribeWidth(callback: () => void) {
  widthListeners.add(callback);
  return () => widthListeners.delete(callback);
}

function setWidthValue(next: number) {
  const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
  widthValue = clamped;
  widthInitialized = true;
  window.localStorage.setItem(WIDTH_KEY, String(clamped));
  widthListeners.forEach((cb) => cb());
}

type NavItem = { href: string; label: string; icon: React.ReactNode; isActive: (path: string) => boolean };
type NavGroup = { label: string; items: NavItem[] };

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
      {children}
    </svg>
  );
}

// ── "Did my click land?" (§36.4, §36.19) ────────────────────────────────────
//
// Every tab in this app is dynamically rendered (the (app) layout awaits auth(), see
// its note), so a click is followed by a real server round trip. The destination now
// paints a skeleton for that wait — but the skeleton belongs to the CONTENT AREA, and
// the thing the user's cursor is on is this link. §36.19 wants a response within
// ~100ms; this is it.
//
// useLinkStatus (next/link, 15.3+) reports the pending state of the enclosing <Link>,
// which is why this has to be its own component rendered inside one. Its own docs warn
// that inline indicators "can easily introduce layout shifts" and recommend a
// fixed-size, always-rendered element toggled by opacity — which is exactly what this
// is: the 6px dot occupies its slot in every state, and only `data-pending` changes.
// The 120ms reveal delay lives in the CSS (.motion-link-hint), shared with the page
// skeleton, so a prefetched route that lands immediately shows neither.
function NavPendingHint() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      data-pending={pending ? "true" : "false"}
      className="motion-link-hint ml-auto flex h-1.5 w-1.5 shrink-0 items-center justify-center"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[#4C8DE8]" />
    </span>
  );
}

const GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      {
        href: "/",
        label: "Dashboard",
        isActive: (p) => p === "/",
        icon: (
          <Icon>
            <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
            <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
            <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
            <rect x="9" y="9" width="5.5" height="5.5" rx="1" />
          </Icon>
        ),
      },
    ],
  },
  {
    label: "Work",
    items: [
      {
        href: "/employees",
        label: "Employees",
        isActive: (p) => p === "/employees",
        icon: (
          <Icon>
            <circle cx="6" cy="5.5" r="2.5" />
            <path d="M1.5 13.5 C1.5 10.5 3.5 9.5 6 9.5 C8.5 9.5 10.5 10.5 10.5 13.5" strokeLinecap="round" />
            <circle cx="11.5" cy="6" r="2" />
            <path d="M12 9.5 C13.8 9.8 14.8 11 14.8 13" strokeLinecap="round" />
          </Icon>
        ),
      },
    ],
  },
  {
    label: "Planning",
    items: [
      {
        href: "/quoted",
        label: "Projects",
        isActive: (p) => p === "/quoted",
        icon: (
          <Icon>
            <circle cx="8" cy="8" r="6" />
            <line x1="8" y1="2" x2="8" y2="8" strokeLinecap="round" />
          </Icon>
        ),
      },
      {
        href: "/etc",
        label: "Monthly ETC",
        isActive: (p) => p === "/etc",
        icon: (
          <Icon>
            <rect x="2" y="2" width="12" height="12" rx="1.5" />
            <line x1="2" y1="6" x2="14" y2="6" />
          </Icon>
        ),
      },
      {
        href: "/job-hours",
        label: "Job Hour Details",
        isActive: (p) => p === "/job-hours",
        icon: (
          <Icon>
            <line x1="2" y1="14" x2="14" y2="14" strokeLinecap="round" />
            <rect x="2.5" y="8" width="2.5" height="5" rx="0.5" />
            <rect x="6.75" y="4.5" width="2.5" height="8.5" rx="0.5" />
            <rect x="11" y="6.5" width="2.5" height="6.5" rx="0.5" />
          </Icon>
        ),
      },
    ],
  },
];

const ADMIN_GROUP: NavGroup = {
  label: "Admin",
  items: [
    {
      href: "/audit-log",
      label: "Audit Log",
      isActive: (p) => p === "/audit-log",
      icon: (
        <Icon>
          <rect x="2" y="2" width="12" height="12" rx="1.5" />
          <line x1="4.5" y1="5.5" x2="11.5" y2="5.5" strokeLinecap="round" />
          <line x1="4.5" y1="8" x2="11.5" y2="8" strokeLinecap="round" />
          <line x1="4.5" y1="10.5" x2="8.5" y2="10.5" strokeLinecap="round" />
        </Icon>
      ),
    },
  ],
};

export default function Sidebar({
  userEmail,
  signOutAction,
  schedulerProjectsUrl,
}: {
  userEmail?: string | null;
  // No `role` prop any more — nothing in the sidebar is role-gated.
  signOutAction: () => Promise<void>;
  // Absolute URL of the SDC Scheduler's Projects page, resolved server-side in
  // the layout (SCHEDULER_BASE_URL). Undefined hides the link rather than
  // rendering a dead one.
  schedulerProjectsUrl?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // The Admin group is shown to everyone. Its pages gate themselves with a
  // password (audit-log-gate.ts), and hiding the link as WELL meant that gate
  // could never be reached by anyone it was written for. Role-based hiding was
  // dropped app-wide on 2026-08-02 — this app has one shared team password,
  // not a role hierarchy.
  const baseGroups = [...GROUPS, ADMIN_GROUP];

  // User-chosen link order (localStorage, per browser). useSyncExternalStore
  // rather than reading storage in render — that would hydrate differently from
  // the server — and rather than setState-in-effect, which flickers the default
  // order for a frame and is a lint error in this repo.
  const navOrder = useSyncExternalStore(subscribeNavOrder, readNavOrder, () => NO_NAV_ORDER);
  const allGroups = baseGroups.map((g) => ({ ...g, items: applyNavOrder(g.label, g.items, navOrder) }));
  const hasCustomOrder = Object.keys(navOrder).length > 0;

  // The drag SOURCE lives in a ref, not state: dragover/drop can fire in the same
  // tick as dragstart, and a state update isn't visible to those handlers yet —
  // which silently dropped the reorder. The ref is read synchronously and is always
  // current. State mirrors it purely so the row can dim while it's being dragged.
  const dragRef = useRef<{ group: string; index: number } | null>(null);
  const [drag, setDrag] = useState<{ group: string; index: number } | null>(null);
  const [over, setOver] = useState<{ group: string; index: number } | null>(null);

  function reorder(group: string, items: { href: string }[], from: number, to: number) {
    const hrefs = moveItem(items, from, to);
    // Nothing moved (Alt+Up on the first item, a drop onto itself, a one-item
    // group): write nothing. Persisting a no-op would light up "Reset order" as
    // though the user had customised something.
    if (hrefs.every((h, i) => h === items[i].href)) return;
    writeNavOrder({ ...navOrder, [group]: hrefs });
  }

  // Nav filter behind the search field. Groups whose every item is filtered out
  // drop away with their heading, so there are no orphan labels.
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const groups = q
    ? allGroups
        .map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q)) }))
        .filter((g) => g.items.length > 0)
    : allGroups;

  // Ctrl+K focuses the filter. The hint is static "Ctrl K" rather than the mock's
  // ⌘K, and deliberately not platform-detected: everyone reaches this app from
  // Windows (it's LAN-only on SERVER-APP1), and detecting via `navigator` needs
  // either a setState-in-effect or a hydration-mismatching lazy initial state.
  // The handler still accepts ⌘ as well, so a Mac visitor isn't locked out.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Hidden entry point for the password-gated Standard Sheet columns: the box
  // that reveals them is intentionally undiscoverable on the /etc page itself
  // (only a few people are meant to know it exists). Clicking the "Monthly ETC"
  // item three times in quick succession takes you to /etc with the secret flag
  // that renders the password box; a normal single click just opens /etc.
  const etcClickCount = useRef(0);
  const etcClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleEtcClick(e: React.MouseEvent) {
    etcClickCount.current += 1;
    if (etcClickTimer.current) clearTimeout(etcClickTimer.current);
    if (etcClickCount.current >= 3) {
      etcClickCount.current = 0;
      e.preventDefault();
      router.push("/etc?standards=1");
      return;
    }
    // Reset the streak if the next click doesn't land within the window. Kept
    // generous so the third click reliably lands the first time — each click
    // also navigates to /etc, so the window has to absorb that latency.
    etcClickTimer.current = setTimeout(() => {
      etcClickCount.current = 0;
    }, 1500);
  }

  // Leaving /etc with unsaved New ETC values (typing alone doesn't autosave —
  // see EtcSectionCells/EtcAutosave) is a plain client-side route
  // change, so it never fires the browser's native beforeunload warning.
  // This is the sidebar's equivalent of that warning; every nav item runs it
  // before whatever else it does (like the /etc triple-click above).
  function handleNavClick(e: React.MouseEvent, href: string) {
    if (isEtcDirty() && !window.confirm("You have unsaved New ETC changes that haven't been saved. Leave this page anyway?")) {
      e.preventDefault();
      return;
    }
    if (href === "/etc") handleEtcClick(e);
  }

  // Global Back — returns to the exact previous view (its URL preserves the
  // filters/sort/scroll that were active), so e.g. Projects → a job's Job Hour
  // Details → Back lands you right back on the Projects grid as you left it.
  // Hidden when there's no in-app history to return to (fresh/direct load), and
  // guarded by the same unsaved-New-ETC check as the nav items.
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => {
    setCanGoBack(window.history.length > 1);
  }, [pathname]);
  function handleBack() {
    if (isEtcDirty() && !window.confirm("You have unsaved New ETC changes that haven't been saved. Go back anyway?")) return;
    router.back();
  }
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const persistedWidth = useSyncExternalStore(subscribeWidth, getWidthSnapshot, getServerWidthSnapshot);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = dragWidth ?? persistedWidth;

  function toggleCollapsed() {
    setCollapsedValue(!collapsed);
  }

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = persistedWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMouseMove(ev: MouseEvent) {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX)));
      setDragWidth(next);
    }

    function onMouseUp(ev: MouseEvent) {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX)));
      setWidthValue(next);
      setDragWidth(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  return (
    <aside
      aria-label="Primary navigation"
      style={{ width: collapsed ? undefined : width }}
      // Pin the sidebar to the viewport height with its own internal scroll
      // (the nav is flex-1 overflow-y-auto below). Without this the aside
      // stretches to match the page content, so on tall tabs (Projects /
      // Monthly ETC grids) it grew very tall and pushed the bottom controls
      // (Text size / Refresh / Collapse / user) far down the page — making the
      // item positions appear to shift between tabs. sticky+h-screen keeps it
      // fixed to the viewport regardless of how tall the page content is.
      // Dark navy sidebar (#061D39) — the "Porcelain" layout (design ref: SDC
      // Sidebar.html, variant 1B) recolored to the SDC brand navy.
      // Sizes are in px, not rem, deliberately: the Text size control scales the
      // root font-size to size the DATA GRIDS (commit 245ebe7), and letting the
      // app chrome grow with it made the nav crowd the content. The design was
      // authored at fixed sizes, so the sidebar now holds its proportions while
      // Text size keeps doing its real job on the grids.
      className={`sticky top-0 z-20 flex h-screen max-h-screen shrink-0 flex-col self-start border-r border-[#12314F] bg-[#061D39] ${
        // motion-panel-size is the ONE justified width animation in the app (§36.15
        // discourages animating width, and rightly): the sidebar's width IS the thing
        // changing when it collapses, and no transform expresses that without leaving
        // the page content overlapped. Suppressed entirely while the user is dragging
        // the resize handle — a transition there would lag the pointer by a frame and
        // feel like the drag was fighting back.
        dragWidth === null ? "motion-panel-size" : ""
      } ${collapsed ? "w-16" : ""}`}
    >
      {!collapsed && (
        <div
          onMouseDown={startResize}
          title="Drag to resize"
          className="absolute top-0 right-0 z-10 h-full w-1.5 -mr-0.5 cursor-col-resize hover:bg-white/[0.10] active:bg-white/[0.10]"
        />
      )}
      <div className={`flex items-center gap-[11px] ${collapsed ? "justify-center px-0 pt-5 pb-[18px]" : "px-[18px] pt-5 pb-[18px]"}`}>
        {/* Slightly lifted tile so the white-on-navy SDC mark still reads as a
            distinct badge against the navy panel behind it. */}
        <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-[#0D2A49] shadow-[inset_0_0_0_1px_#1B4270]">
          <Image src="/brand/sdc-logo-white.png" alt="SDC" width={26} height={14} unoptimized />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight tracking-[-0.005em] text-[#F3F6FA]">SDC Projects Reports</p>
            <p className="truncate text-note text-[#7E93AC]">Steven Douglas Corp.</p>
          </div>
        )}
      </div>

      {/* Search — the design shows this field, so it had to be real rather than
          decorative: it filters the nav below by label. ⌘/Ctrl+K focuses it,
          Escape clears. Hidden when collapsed (no room for a text field). */}
      {!collapsed && (
        <div className="px-[14px] pb-[14px]">
          <div className="flex h-8 items-center gap-[9px] rounded-[7px] bg-[#0B2846] px-[10px] shadow-[inset_0_0_0_1px_#17395C,0_1px_1px_rgba(0,0,0,0.35)] focus-within:shadow-[inset_0_0_0_1px_#4C8DE8]">
            <span className="h-[11px] w-[11px] shrink-0 rounded-full shadow-[inset_0_0_0_1.4px_#5F7B98]" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
              placeholder="Search reports"
              aria-label="Filter navigation"
              className="min-w-0 flex-1 bg-transparent text-xs text-[#C3D1E0] placeholder:text-[#7189A3] focus:outline-none"
            />
            {query === "" && <span className="ml-auto font-mono text-label tracking-[0.04em] text-[#6E86A0]">Ctrl K</span>}
          </div>
        </div>
      )}

      {canGoBack && (
        <div className={collapsed ? "px-0 pb-1" : "px-[14px] pb-1"}>
          <button
            onClick={handleBack}
            title="Go back to the previous page"
            className={`flex h-8 w-full items-center gap-[10px] rounded-[7px] text-xs text-[#A9BCD0] hover:bg-[#0E3157] hover:text-[#F3F6FA] ${
              collapsed ? "justify-center px-0" : "px-[10px]"
            }`}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              <Icon>
                <path d="M9.5 3 L4.5 8 L9.5 13" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="4.5" y1="8" x2="13" y2="8" strokeLinecap="round" />
              </Icon>
            </span>
            {/* "Back" not the mock's "Back to workspace": this runs router.back(),
                so the honest label is the one that matches the behavior. */}
            {!collapsed && <span>Back</span>}
          </button>
        </div>
      )}

      <nav aria-label="Application sections" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-[14px]">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-[3px]">
            {!collapsed && (
              <p className="px-[10px] pb-[7px] font-mono text-micro tracking-[0.16em] text-[#6E88A5] uppercase">
                {group.label}
              </p>
            )}
            <div className="flex flex-col gap-[3px]">
              {group.items.map((item, index) => {
                const active = item.isActive(pathname);
                const isDragging = drag?.group === group.label && drag.index === index;
                const isOver = over?.group === group.label && over.index === index && !isDragging;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={(e) => handleNavClick(e, item.href)}
                    title={collapsed ? item.label : `${item.label} — drag to reorder, or Alt+↑/↓`}
                    // Reorderable by drag, and by Alt+Arrow for anyone not using a
                    // mouse. Only within this group: the headings above say what
                    // these links are, so a link that moved out from under one
                    // would make the heading wrong.
                    draggable={group.items.length > 1}
                    onDragStart={(e) => {
                      dragRef.current = { group: group.label, index };
                      setDrag({ group: group.label, index });
                      // Firefox ignores a drag with no payload; the href is also the
                      // sensible thing to hand to anything else that accepts a drop.
                      e.dataTransfer.setData("text/plain", item.href);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      const src = dragRef.current;
                      if (!src || src.group !== group.label) return; // never across groups
                      e.preventDefault(); // required, or the drop never fires
                      e.dataTransfer.dropEffect = "move";
                      setOver({ group: group.label, index });
                    }}
                    onDrop={(e) => {
                      const src = dragRef.current;
                      if (!src || src.group !== group.label) return;
                      e.preventDefault();
                      reorder(group.label, group.items, src.index, index);
                      dragRef.current = null;
                      setDrag(null);
                      setOver(null);
                    }}
                    onDragEnd={() => {
                      dragRef.current = null;
                      setDrag(null);
                      setOver(null);
                    }}
                    onKeyDown={(e) => {
                      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                      e.preventDefault(); // don't scroll the nav while moving an item
                      reorder(group.label, group.items, index, index + (e.key === "ArrowUp" ? -1 : 1));
                    }}
                    // Active state is a raised white "card" (ring + 1px shadow)
                    // with a 2px inset accent bar, not a filled block — the mock's
                    // way of marking the current page on a light panel.
                    // ── No justify-center toggle (§36.12: "icons and labels must not
                    // jump") ────────────────────────────────────────────────────
                    //
                    // It used to add `justify-center` when collapsed, which is what made
                    // collapsing lurch: the class applies on the frame of the click while
                    // the aside is still 276px wide, so the icon leapt to the middle of a
                    // wide panel and the panel then narrowed around it.
                    //
                    // Removing it changes nothing about the settled collapsed state — and
                    // that is measured in the running app, not assumed. The rail is w-16,
                    // which is 60px here because the root font-size is 15px (see
                    // AppTextSize); the nav pads 14px and the link 10px, so a 15px icon
                    // starts at 24px and is centred at 31.5px against the rail's own
                    // centre of 30px. One and a half pixels, against the 114px leap
                    // `justify-center` caused mid-collapse. Verified afterwards: the icon
                    // sits at x=24 expanded, mid-collapse and collapsed — it does not
                    // move horizontally at all.
                    className={`relative flex h-9 items-center gap-[11px] rounded-[7px] px-[10px] text-sm motion-interactive ${
                      active
                        ? "bg-[#0E3159] font-medium text-[#FFFFFF] shadow-[inset_0_0_0_1px_#1B4270,0_1px_2px_rgba(0,0,0,0.45)]"
                        : "text-[#C3D1E0] hover:bg-[#0E3157]"
                    } ${isDragging ? "opacity-40" : ""} ${
                      // Insertion line where the dragged item would land, drawn on
                      // the target rather than moving anything until the drop.
                      isOver ? "shadow-[inset_0_2px_0_0_#4C8DE8]" : ""
                    }`}
                  >
                    {/* The active-page accent bar fades in rather than appearing (§36.12:
                        "the active-tab indicator must transition cleanly"). It is
                        absolutely positioned, so it has never affected the row's layout —
                        only its arrival was abrupt. */}
                    {active && <span className="motion-fade absolute top-[9px] bottom-[9px] left-0 w-[2px] rounded-r-[2px] bg-[#4C8DE8]" />}
                    <span className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center ${active ? "text-[#4C8DE8]" : "text-[#8FA6BE]"}`}>
                      {item.icon}
                    </span>
                    {!collapsed && (
                      <>
                        <span className="truncate">{item.label}</span>
                        <NavPendingHint />
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {/* Only offered once the order has actually been customised — a permanent
            "Reset order" would be clutter for the majority who never drag anything. */}
        {hasCustomOrder && !collapsed && (
          <button
            type="button"
            onClick={clearNavOrder}
            className="self-start px-[10px] text-label text-[#6E88A5] underline decoration-dotted underline-offset-2 hover:text-[#C3D1E0]"
            title="Put the sidebar links back in their default order"
          >
            Reset order
          </button>
        )}

        {/* Cross-app link out to the SDC Scheduler. Deliberately NOT part of
            GROUPS: those are internal next/link routes with an isActive test,
            while this is a different app on another port — a plain <a> in a new
            tab, so the report you're on is never lost. The Scheduler has the
            mirror-image button back to here. */}
        {schedulerProjectsUrl && (
          <div className="flex flex-col gap-[3px]">
            {!collapsed && (
              <p className="px-[10px] pb-[7px] font-mono text-micro tracking-[0.16em] text-[#6E88A5] uppercase">Apps</p>
            )}
            <a
              href={schedulerProjectsUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the SDC Scheduler's Projects page in a new tab"
              className={`flex h-9 items-center gap-[11px] rounded-[7px] px-[10px] text-sm text-[#C3D1E0] motion-interactive hover:bg-[#0E3157] ${
                collapsed ? "justify-center" : ""
              }`}
            >
              <span className="flex h-[15px] w-[15px] shrink-0 items-center justify-center text-[#8FA6BE]">
                {/* Same staggered gantt bars used for the Scheduler link in the
                    grids, so the two read as the same destination. */}
                <Icon>
                  <line x1="2.5" y1="3.5" x2="9.5" y2="3.5" strokeLinecap="round" />
                  <line x1="5.5" y1="8" x2="13.5" y2="8" strokeLinecap="round" />
                  <line x1="3.5" y1="12.5" x2="10.5" y2="12.5" strokeLinecap="round" />
                </Icon>
              </span>
              {!collapsed && (
                <>
                  <span className="truncate">Project Scheduler</span>
                  {/* External-link cue, matching the new-tab behavior. */}
                  <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" className="ml-auto shrink-0 text-[#6E88A5]">
                    <path d="M6 3 H13 V10" strokeLinecap="round" strokeLinejoin="round" />
                    <line x1="13" y1="3" x2="6.5" y2="9.5" strokeLinecap="round" />
                  </svg>
                </>
              )}
            </a>
          </div>
        )}
      </nav>

      {/* Footer block — one bordered group holding Text size, the Refresh/
          Collapse pair, and the account row, per the mock. */}
      <div className={`flex flex-col border-t border-[#12314F] ${collapsed ? "px-0 pt-2.5 pb-3" : "px-[14px] pt-2.5 pb-3"}`}>
        <AppTextSize collapsed={collapsed} />

        {/* Side-by-side in the mock rather than the two stacked full-width rows
            this used to be — it reclaims a row of vertical space. Stacks again
            when collapsed, where there's no width for two. */}
        <div className={`flex gap-1.5 pt-1 pb-2.5 ${collapsed ? "flex-col" : ""}`}>
          {/* THE refresh control (§25). It used to be `window.location.reload()` —
              which, to anyone reading the label, was a second refresh button that
              refreshed no data at all: it re-read the same rows the last sync had left
              behind. It now runs the one application-wide pass, from every page, and the
              reload it replaces is unnecessary because the action revalidates the routes
              and broadcasts to the other tabs. */}
          {/* ── One Refresh Data, and it lives here (§41.16, 2026-08-05) ────────
              This was hidden on /etc from §29 until 2026-08-05, because §29 had moved a
              second copy into the Monthly ETC toolbar on the reasoning that "the sidebar
              collapses to a rail, and a control nobody can find is not a control".
              §41.16 reverses that and asks for one application-wide control here. The
              discoverability worry §29 raised is real but is answered by the rail rather
              than by a second button: `compact={collapsed}` keeps it visible as an icon
              with its label as a tooltip, so it never disappears — and the ETC toolbar
              copy is gone, so there is exactly ONE on screen on every route.
              There was only ever one refresh PATH (lib/refresh-actions ->
              refresh-service -> runAllSyncs); this was always about how many buttons
              point at it. */}
          <RefreshDataButton
            compact={collapsed}
            // This button is `flex-1` beside Collapse — 128px at the default sidebar
            // width. `dense` keeps its label to what fits (see the note on the prop).
            dense
            className="motion-interactive flex h-[30px] flex-1 items-center justify-center gap-[7px] rounded-[7px] bg-[#0B2846] px-2 text-xs whitespace-nowrap text-[#C3D1E0] shadow-[inset_0_0_0_1px_#17395C] hover:bg-[#0E3157] disabled:opacity-60"
          />

          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
            className="flex h-[30px] flex-1 items-center justify-center gap-[7px] rounded-[7px] bg-[#0B2846] text-xs text-[#C3D1E0] shadow-[inset_0_0_0_1px_#17395C] hover:bg-[#0E3157]"
          >
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              <Icon>
                {collapsed ? (
                  <path d="M6 3 L11 8 L6 13" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M10 3 L5 8 L10 13" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </Icon>
            </span>
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>

        <div className={`flex items-center gap-[10px] border-t border-[#12314F] pt-2.5 ${collapsed ? "justify-center" : "px-[10px]"}`}>
          <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#123B66] text-note font-semibold text-[#4C8DE8]">
            {userEmail?.[0]?.toUpperCase() ?? "?"}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-note text-[#C3D1E0]">{userEmail}</p>
              <form action={signOutAction}>
                <button
                  onClick={(e) => {
                    if (isEtcDirty() && !window.confirm("You have unsaved New ETC changes that haven't been saved. Sign out anyway?")) {
                      e.preventDefault();
                    }
                  }}
                  className="text-note text-[#7189A3] hover:text-[#C3D1E0] hover:underline"
                >
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>

        {/* The running application version. In the sidebar, so it is on every tab
            without each page having to render it, and sourced from
            lib/app-version.ts — which reads the ONE value in package.json — so no
            component can ever report a different number. Hidden when collapsed:
            the rail is 26px of icons there and a version string would not fit.
            `title` keeps it reachable for a bug report either way. */}
        {!collapsed && (
          <div
            className="border-t border-[#12314F] px-[10px] pt-2 text-label text-[#5A7391]"
            title={`SDC Projects Reports ${appVersionLabel()}`}
          >
            {appVersionLabel()}
          </div>
        )}
      </div>
    </aside>
  );
}
