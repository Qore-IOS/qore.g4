
import { Urbanist } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/contexts/auth-context";
import { QueryProvider } from "@/contexts/query-context";
import { Toaster } from "@/components/ui/toaster";
import MobileResponsiveFix from "@/components/responsive/MobileResponsiveFix";
import WebVitalsReporter from "@/components/perf/WebVitalsReporter";
import React from "react";

const urbanist = Urbanist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-urbanist",
  display: "swap",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" suppressHydrationWarning className={urbanist.variable}>
      <head>
        <title>Qore</title>
        <meta name="description" content="Advanced Inventory Management" />
        <meta name="theme-color" content="#000000" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"
        />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        {/* PERF: ikonlar 0.7MB ham logo yerine küçük türevlerden gelir
            (scripts/optimize-brand-assets.mjs) — eski hali her sayfa
            yüklemesinde ~1.4MB gereksiz transferdi. */}
        <link
          rel="icon"
          href="/icon-192.png"
          type="image/png"
        />
        <link
          rel="apple-touch-icon"
          href="/apple-touch-icon.png"
        />
      </head>
      <body className={urbanist.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <QueryProvider>
              <MobileResponsiveFix />
              {children}
              <Toaster />
              <WebVitalsReporter />
            </QueryProvider>
          </AuthProvider>
        </ThemeProvider>
        {/* PDF.js is loaded lazily where needed - see src/lib/pdf.ts */}
        
        {/* Google Analytics via next/script lazyOnload */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-TGHCKJKWEZ"
          strategy="lazyOnload"
        />
        <Script id="google-analytics" strategy="lazyOnload">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-TGHCKJKWEZ', {
              page_path: window.location.pathname,
            });
          `}
        </Script>
      </body>
    </html>
  );
}
