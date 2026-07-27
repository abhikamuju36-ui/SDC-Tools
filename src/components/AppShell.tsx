import Sidebar from "@/components/Sidebar";
import ExcelCellFocus from "@/components/ExcelCellFocus";
import RowSelect from "@/components/RowSelect";
import ColumnResize from "@/components/ColumnResize";
import { ToastProvider } from "@/components/ui/Toast";

export default function AppShell({
  children,
  userEmail,
  role,
  signOutAction,
}: {
  children: React.ReactNode;
  userEmail?: string | null;
  role?: string;
  signOutAction: () => Promise<void>;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Keyboard/AT skip-link — jumps past the sidebar to the page content.
          Visually hidden until focused. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-sdc-navy focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <Sidebar userEmail={userEmail} role={role} signOutAction={signOutAction} />
      <main id="main-content" className="min-w-0 flex-1 bg-background">
        <ToastProvider>{children}</ToastProvider>
      </main>
      <ExcelCellFocus />
      <RowSelect />
      <ColumnResize />
    </div>
  );
}
