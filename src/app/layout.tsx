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
    <html
      lang="en"
      className={`${montserrat.variable} h-full antialiased`}
      // The pre-paint script below writes to this element's `style` attribute
      // (root font-size + the five grid density vars) before React hydrates, so
      // React's expected <html> — which has no style attribute at all — can never
      // match the DOM. That logged a hydration error on EVERY page, ending in
      // "This won't be patched up", which buries any real mismatch in noise.
      //
      // This is the React-sanctioned escape for a deliberate, unavoidable
      // server/client difference, and the same thing next-themes does for the
      // identical problem. It is NOT a blanket silencer: it covers only this
      // element's own attributes and does not cascade to children, so a genuine
      // mismatch anywhere inside the app still reports.
      //
      // The alternative — moving the preference to a cookie so the server could
      // render the style itself — would remove the difference rather than excuse
      // it, but it changes where the preference lives and costs a cookie on every
      // request. Not worth it for a display preference.
      suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        {/* Restore every persisted display preference BEFORE first paint.
            Tailwind sizes are rem, so the root font-size scales the whole UI
            proportionally (see AppTextSize); the five grid vars drive row
            height, column width and cell text on the Monthly ETC and Projects
            grids (EtcViewMenu, ProjectsDisplayMenu / GridZoomControls).

            The grid vars used to be applied in mount effects, which is one
            frame too late: the grid painted at the default density and then
            visibly jumped to the saved one on every page load. The root
            font-size was already handled here — this just extends the same
            treatment to the rest, since a preference restored after paint is
            a preference the user watches being restored.

            Inline and blocking on purpose: it has to run before the first
            paint, which rules out an effect and rules out `defer`. Wrapped in
            try/catch because localStorage throws outright in some privacy
            modes, and a preference is never worth a blank page. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var d=document.documentElement,s=localStorage.getItem('app-font-px');if(s)d.style.fontSize=parseFloat(s)+'px';var v=[['etc-grid-font-size','--etc-font-size'],['etc-grid-row-py','--etc-row-py'],['etc-grid-col-px','--etc-col-px'],['quoted-grid-row-py','--quoted-row-py'],['quoted-grid-col-px','--quoted-col-px']];for(var i=0;i<v.length;i++){var r=localStorage.getItem(v[i][0]);if(r!=null&&r!==''){var n=parseFloat(r);if(!isNaN(n))d.style.setProperty(v[i][1],n+'px');}}}catch(e){}`,
          }}
        />
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
