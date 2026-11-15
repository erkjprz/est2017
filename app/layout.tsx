import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Manrope } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { ThemeProvider } from "@/app/components/ThemeProvider";
import { ScrollToTop } from "@/app/scroll-to-top";
import { AuthProvider } from "@/app/auth-context";
import { ServiceWorkerRegister } from "@/app/components/ServiceWorkerRegister";
import { EditTransactionSheetHost } from "@/app/components/EditTransactionSheetHost";
import { PwaOnboardingSheet } from "@/app/components/PwaOnboardingSheet";
import { AdminTourHost } from "@/app/components/admin/AdminTour";
import { InstallGate } from "@/app/components/InstallGate";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// globals.css's --font-display references --font-manrope -- this is what
// actually loads it, matching the pattern already used for Geist/Geist Mono.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Est. 2017",
  description: "Shared fund tracker",
  appleWebApp: {
    title: "Est. 2017",
    statusBarStyle: "black-translucent",
  },
  other: {
    // Next's `appleWebApp` only emits the modern, unprefixed
    // "mobile-web-app-capable" tag -- iOS's own "Add to Home Screen"
    // standalone wrapper still keys its safe-area/viewport layout off this
    // older Apple-specific one. Without it, the installed icon can size its
    // content area short of the real screen, even though the exact same
    // page in a plain Safari tab is unaffected.
    "apple-mobile-web-app-capable": "yes",
  },
};

// Theme follows the device's prefers-color-scheme by default, unless the
// user has explicitly picked light or dark (stored in localStorage -- see
// ThemeProvider). "dark" here is just the pre-hydration fallback for the
// rare case JS hasn't run yet; ThemeProvider (and the inline script below)
// resolve the real value before paint.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
  colorScheme: "dark light",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs synchronously during HTML parsing, before first paint --
            applies the stored theme override if there is one, otherwise
            resolves the device's prefers-color-scheme, so a hard reload
            never shows a flash of the wrong theme while React hydrates.
            Without this, a window.location.reload() (account's name change,
            the deploy-refresh check in ServiceWorkerRegister) briefly
            painted the wrong background every time. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("haru-theme");var isDark=t==="dark"?true:t==="light"?false:window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",isDark);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",isDark?"#0a0a0a":"#ffffff")}catch(e){}})()`
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ScrollToTop />
        <ServiceWorkerRegister />
        <AuthProvider>
          <ThemeProvider>{children}</ThemeProvider>
          {/* Mounted once here, not per-page -- LoanCards (on /borrower,
              which has no Navbar) and the Transactions list both need to be
              able to open this, and the FAB's own NewTransactionSheet only
              lives in Navbar, which borrowers never see. */}
          <EditTransactionSheetHost />
          {/* Install + notifications onboarding -- decides for itself
              whether there's anything to offer on this device. */}
          <PwaOnboardingSheet />
          {/* New-admin guided tour -- spans several pages, so it lives here
              rather than on /admin, which only starts it. */}
          <AdminTourHost />
          {/* Full-screen install prompt on the signed-out mobile entry
              points (/login, /signup) -- skippable, see InstallGate. */}
          <InstallGate />
        </AuthProvider>
        <Analytics />
        {/* iOS only recomputes a `position: fixed` element's layout in
            response to an actual scroll event -- on a page too short to
            scroll on its own (a loading screen, a short list), that never
            fires, and fixed overlays like Sheet's can end up laid out
            against a stale/short viewport, especially in the installed
            home-screen app. Navbar's own scroll-nudge (scrollTo a pixel and
            back) forces the recompute, but only has something to nudge into
            if the page has real overflow -- this guarantees that
            unconditionally, regardless of any given page's own content.
            Absolutely positioned behind everything and inert (aria-hidden,
            no pointer events, no visible color) so it's never seen or felt,
            just scrolled into. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "calc(100vh + 40px)",
            zIndex: -1,
            pointerEvents: "none"
          }}
        />
      </body>
    </html>
  );
}
