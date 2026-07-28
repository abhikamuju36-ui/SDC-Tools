import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/SessionProvider";

// The SDC Brand Guide's web font — Montserrat is the guide's designated
// closest web-safe match to the brand print font (Core Sans NR), used app-wide
// (body + headings) so the UI is typographically on-brand and consistent.
// Body weights (400/500) plus headline weights (600/700).
const montserrat = Montserrat({
  variable: "--font-montserrat",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SDC Projects Reports",
  description: "Project reporting and estimate-to-complete tracking for SDC projects",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* App-wide text size: restore the saved root font-size before paint so
            there's no flash. Tailwind sizes are rem, so this scales the whole
            UI proportionally. See AppTextSize. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=localStorage.getItem('app-font-px');if(s){document.documentElement.style.fontSize=parseFloat(s)+'px';}}catch(e){}`,
          }}
        />
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
