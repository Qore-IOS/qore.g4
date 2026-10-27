
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/contexts/auth-context";
import { QueryProvider } from "@/contexts/query-context";
import { Toaster } from "@/components/ui/toaster";
import MobileResponsiveFix from "@/components/responsive/MobileResponsiveFix";
import WebVitalsReporter from "@/components/perf/WebVitalsReporter";
import React from "react";
import LegacyServiceCleanup from "@/components/LegacyServiceCleanup";

const urbanist = localFont({
  src: [{path:"../../node_modules/@fontsource-variable/urbanist/files/urbanist-latin-wght-normal.woff2"},{path:"../../node_modules/@fontsource-variable/urbanist/files/urbanist-latin-ext-wght-normal.woff2"}],
  variable: "--font-urbanist", weight: "100 900", display: "swap",
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
        <link
          rel="icon"
          href="/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG"
          type="image/png"
        />
        <link
          rel="apple-touch-icon"
          href="/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG"
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
            <LegacyServiceCleanup />
            <QueryProvider>
              <MobileResponsiveFix />
              {children}
              <Toaster />
              <WebVitalsReporter />
            </QueryProvider>
          </AuthProvider>
        </ThemeProvider>
        {/* PDF.js is loaded lazily where needed - see src/lib/pdf.ts */}
        

      </body>
    </html>
  );
}
