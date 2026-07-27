"use client";

// App-wide toast notifications — one shared system replacing the three
// hand-rolled `useState + setTimeout + fixed div` toasts (RunReportButton,
// SyncHistoryButton, EtcSyncMenu) that each had different durations/positions.
// Mounted once in AppShell; any client component calls useToast().toast(...).
//
// useToast() returns a no-op when used outside the provider, so a component
// that renders in isolation (tests, stories) never crashes.

import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastType = "success" | "error" | "info";
type ToastItem = { id: number; message: string; type: ToastType };
type ToastCtxValue = { toast: (message: string, type?: ToastType) => void };

const ToastCtx = createContext<ToastCtxValue | null>(null);

export function useToast(): ToastCtxValue {
  return useContext(ToastCtx) ?? { toast: () => {} };
}

function Glyph({ type }: { type: ToastType }) {
  const common = { viewBox: "0 0 16 16", width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 1.8 } as const;
  if (type === "error") {
    return (
      <svg {...common} className="mt-0.5 shrink-0">
        <path d="M8 1.8 L14.5 13.5 H1.5 Z" strokeLinejoin="round" />
        <line x1="8" y1="6.2" x2="8" y2="9.5" strokeLinecap="round" />
        <line x1="8" y1="11.6" x2="8" y2="11.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "info") {
    return (
      <svg {...common} className="mt-0.5 shrink-0">
        <circle cx="8" cy="8" r="6.5" />
        <line x1="8" y1="7.3" x2="8" y2="11.2" strokeLinecap="round" />
        <line x1="8" y1="4.8" x2="8" y2="4.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common} className="mt-0.5 shrink-0">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5 8.2 L7.2 10.4 L11 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((message: string, type: ToastType = "success") => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    // Errors linger longer than confirmations.
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), type === "error" ? 6000 : 4000);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg ${
              t.type === "error"
                ? "border-sdc-red-border bg-sdc-red-bg text-sdc-red-text"
                : t.type === "info"
                  ? "border-sdc-border bg-white text-sdc-navy"
                  : "border-sdc-green/40 bg-sdc-green-bg text-sdc-green-text"
            }`}
          >
            <Glyph type={t.type} />
            <span className="min-w-0 flex-1 font-medium break-words">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="-mr-1 shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
            >
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 4 L12 12 M12 4 L4 12" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
