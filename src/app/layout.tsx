
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/contexts/auth-context";
import { Toaster } from "@/components/ui/toaster";
import { LoadingProvider } from "@/contexts/loading-context";
import MobileResponsiveFix from "@/components/responsive/MobileResponsiveFix";
import React from "react";
import AppBackground from "@/components/AppBackground";
import Script from "next/script";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <title>Qore</title>
        <meta name="description" content="Advanced Inventory Management" />
        <meta name="theme-color" content="#000000" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1"
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
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <LoadingProvider>
              <MobileResponsiveFix />
              <AppBackground />
              {children}
              <Toaster />
            </LoadingProvider>
          </AuthProvider>
        </ThemeProvider>
        <Script
          src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.min.mjs"
          type="module"
        />
      </body>
    </html>
  );
}
