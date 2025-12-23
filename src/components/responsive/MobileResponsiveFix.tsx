'use client';
import React from 'react';

export default function MobileResponsiveFix() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
/* ========================================
   GLOBAL MOBILE SAFE ZONES & CSS VARIABLES
   ======================================== */
:root {
  /* Mobile safe zone padding - respects device notches, cameras, dynamic islands */
  --mobile-safe-top: max(env(safe-area-inset-top, 0px), 12px);
  --mobile-safe-bottom: max(env(safe-area-inset-bottom, 0px), 16px);
  --mobile-safe-left: max(env(safe-area-inset-left, 0px), 16px);
  --mobile-safe-right: max(env(safe-area-inset-right, 0px), 16px);

  /* Horizontal page padding */
  --page-h-padding: 0rem;

  /* Mobile spacing scale */
  --mobile-gap-xs: 0.5rem;  /* 8px */
  --mobile-gap-sm: 0.75rem; /* 12px */
  --mobile-gap-md: 1rem;    /* 16px */
  --mobile-gap-lg: 1.25rem; /* 20px */

  /* Mobile card padding */
  --mobile-card-padding: 1rem;

  /* Mobile button min height for touch targets */
  --mobile-btn-min-height: 44px;

  /* Bottom dock height consideration */
  --mobile-dock-height: 80px;
}

/* ========================================
   MOBILE BREAKPOINT STYLES (max-width: 768px)
   ======================================== */
@media (max-width: 768px) {
  html, body {
    overflow-x: hidden;
  }

  /* ========================================
     GLOBAL PAGE SHELL SAFE ZONES
     ======================================== */
  .page-shell {
    padding-left: var(--mobile-safe-left);
    padding-right: var(--mobile-safe-right);
    padding-bottom: calc(var(--mobile-dock-height) + var(--mobile-safe-bottom));
  }

  /* ========================================
     CARD RESPONSIVE STYLING
     ======================================== */
  .page-shell .card,
  .page-shell .shadcn-card,
  .page-shell [class*="CardContent"],
  .page-shell [class*="CardHeader"] {
    overflow: hidden;
  }

  /* Responsive card padding */
  .page-shell .card > div,
  .page-shell [class*="p-6"] {
    padding: var(--mobile-card-padding) !important;
  }

  .page-shell .card h1,
  .page-shell .card h2,
  .page-shell .card h3 {
    word-break: break-word;
    overflow-wrap: anywhere;
    font-size: clamp(1rem, 4vw, 1.5rem);
  }

  /* ========================================
     KPI CARDS - CONSISTENT RESPONSIVE SIZING
     ======================================== */
  /* Target KPI cards and ensure consistent sizing */
  .page-shell [class*="grid"] > [class*="rounded-2xl"],
  .page-shell [class*="grid"] > [class*="rounded-xl"],
  .page-shell .kpi-card,
  .page-shell .neu-card {
    padding: var(--mobile-card-padding) !important;
    min-height: auto;
  }

  /* KPI card value text - responsive sizing */
  .page-shell [class*="text-2xl"],
  .page-shell [class*="text-3xl"] {
    font-size: clamp(1.25rem, 5vw, 1.75rem) !important;
  }

  /* KPI card title text */
  .page-shell [class*="text-sm"] {
    font-size: 0.75rem;
    line-height: 1.25;
  }

  /* ========================================
     BUTTON GROUP RESPONSIVE STYLING
     ======================================== */
  .page-shell .btn-group,
  .page-shell [role="tablist"],
  .page-shell .button-group,
  .page-shell .flex.gap-2,
  .page-shell .flex.gap-3,
  .page-shell .flex.gap-4 {
    flex-wrap: wrap;
    row-gap: var(--mobile-gap-sm);
    max-width: 100%;
    overflow-x: visible;
  }

  /* Button responsive sizing */
  .page-shell button,
  .page-shell [role="button"],
  .page-shell .btn {
    min-height: var(--mobile-btn-min-height);
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    white-space: nowrap;
  }

  /* Icon-only buttons on mobile - hide text when needed */
  .page-shell .btn-icon-mobile span:not([class*="sr-only"]),
  .page-shell .mobile-icon-only > span:not([class*="icon"]) {
    display: none;
  }

  /* Ensure icon buttons have proper sizing */
  .page-shell button[class*="icon"],
  .page-shell [class*="h-10"][class*="w-10"] {
    min-width: var(--mobile-btn-min-height);
    min-height: var(--mobile-btn-min-height);
  }

  /* ========================================
     DIALOG/MODAL RESPONSIVE STYLING
     ======================================== */
  .page-shell .dialog-content,
  [role="dialog"],
  [data-state="open"][class*="DialogContent"] {
    width: calc(100vw - var(--mobile-safe-left) - var(--mobile-safe-right)) !important;
    max-width: calc(100vw - var(--mobile-safe-left) - var(--mobile-safe-right)) !important;
    max-height: calc(100vh - var(--mobile-safe-top) - var(--mobile-safe-bottom) - 2rem);
    overflow-y: auto;
    border-radius: 0.75rem;
    margin: 0 auto;
  }

  /* ========================================
     GRID LAYOUTS - RESPONSIVE COLUMN HANDLING
     ======================================== */
  /* Force single column on mobile for most grids */
  .page-shell .stack-on-mobile,
  .page-shell [class*="grid-cols-2"],
  .page-shell [class*="grid-cols-3"],
  .page-shell [class*="grid-cols-4"] {
    display: grid !important;
    grid-template-columns: 1fr !important;
    gap: var(--mobile-gap-md) !important;
  }

  /* Allow 2-column for specific use cases */
  .page-shell .mobile-2-col,
  .page-shell [class*="grid-cols-2"].keep-2-col {
    grid-template-columns: repeat(2, 1fr) !important;
  }

  .page-shell .stack-on-mobile > * {
    min-width: 0;
  }

  /* ========================================
     TABLE TO CARD TRANSFORMATION
     ======================================== */
  .q-table {
    width: 100%;
  }

  .q-table thead {
    display: none;
  }

  .q-table tbody tr {
    display: block;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--background) / 0.6);
    border-radius: 0.75rem;
    padding: var(--mobile-gap-sm);
    margin-bottom: var(--mobile-gap-md);
  }

  .q-table tbody td {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--mobile-gap-sm);
    padding: var(--mobile-gap-sm) var(--mobile-gap-md);
    word-break: break-word;
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .q-table tbody td::before {
    content: attr(data-label);
    font-weight: 600;
    color: hsl(var(--foreground));
    opacity: 0.8;
    text-align: left;
  }

  .q-table tbody td[data-primary="true"] {
    font-size: 0.95rem;
  }

  .q-table tbody td * {
    min-width: 0;
  }

  .q-table tbody td img {
    max-width: 100%;
    height: auto;
    display: inline-block;
  }

  /* ========================================
     FORM ELEMENTS RESPONSIVE STYLING
     ======================================== */
  .page-shell input,
  .page-shell select,
  .page-shell textarea,
  .page-shell [role="combobox"] {
    min-height: var(--mobile-btn-min-height);
    font-size: 16px; /* Prevents zoom on iOS */
  }

  /* Select/Dropdown responsive */
  .page-shell [class*="SelectTrigger"],
  .page-shell [class*="select-trigger"] {
    min-height: var(--mobile-btn-min-height);
    padding: 0.5rem 0.75rem;
  }

  /* ========================================
     FLEX LAYOUTS - RESPONSIVE STACKING
     ======================================== */
  .page-shell .flex-col-mobile,
  .page-shell .flex.items-center.justify-between {
    flex-direction: column;
    align-items: stretch;
    gap: var(--mobile-gap-sm);
  }

  /* Header sections - stack on mobile */
  .page-shell [class*="CardHeader"] .flex {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--mobile-gap-sm);
  }

  /* ========================================
     SCROLLABLE AREAS
     ======================================== */
  .page-shell .scroll-area,
  .page-shell [class*="ScrollArea"] {
    max-height: calc(100vh - var(--mobile-dock-height) - var(--mobile-safe-top) - var(--mobile-safe-bottom) - 4rem);
  }

  /* ========================================
     SPECIFIC PANEL FIXES
     ======================================== */

  /* Mal Kabul Panel - Button Group */
  .page-shell .mal-kabul-actions,
  .page-shell [class*="islemler"] {
    display: grid !important;
    grid-template-columns: repeat(2, 1fr) !important;
    gap: var(--mobile-gap-sm) !important;
  }

  /* Bekleyen Siparisler - Order Cards */
  .page-shell .order-card,
  .page-shell [class*="siparis-card"] {
    padding: var(--mobile-card-padding);
  }

  .page-shell .order-card .flex,
  .page-shell [class*="siparis-card"] .flex {
    flex-wrap: wrap;
    gap: var(--mobile-gap-sm);
  }

  /* Transfer Panel */
  .page-shell .transfer-form,
  .page-shell [class*="direkt-transfer"] {
    padding: var(--mobile-card-padding);
  }

  /* Route Planner */
  .page-shell .route-map {
    height: 50vh;
    min-height: 300px;
  }

  /* ========================================
     BADGE/CHIP RESPONSIVE
     ======================================== */
  .page-shell [class*="Badge"],
  .page-shell .badge {
    font-size: 0.7rem;
    padding: 0.25rem 0.5rem;
    white-space: nowrap;
  }

  /* ========================================
     TABS RESPONSIVE
     ======================================== */
  .page-shell [role="tablist"] {
    display: flex;
    flex-wrap: wrap;
    gap: var(--mobile-gap-xs);
  }

  .page-shell [role="tab"] {
    flex: 1 1 auto;
    min-width: fit-content;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
  }

  /* ========================================
     ACCORDION RESPONSIVE
     ======================================== */
  .page-shell [class*="AccordionTrigger"],
  .page-shell [class*="AccordionContent"] {
    padding: var(--mobile-card-padding);
  }

  /* ========================================
     SPACING UTILITIES - MOBILE OVERRIDE
     ======================================== */
  .page-shell [class*="gap-6"] {
    gap: var(--mobile-gap-md) !important;
  }

  .page-shell [class*="gap-8"] {
    gap: var(--mobile-gap-lg) !important;
  }

  .page-shell [class*="p-6"] {
    padding: var(--mobile-card-padding) !important;
  }

  .page-shell [class*="p-8"] {
    padding: var(--mobile-gap-lg) !important;
  }

  .page-shell [class*="mb-6"] {
    margin-bottom: var(--mobile-gap-md) !important;
  }

  .page-shell [class*="mb-8"] {
    margin-bottom: var(--mobile-gap-lg) !important;
  }

  /* ========================================
     ICON SIZING - MOBILE
     ======================================== */
  .page-shell [class*="h-6"][class*="w-6"],
  .page-shell [class*="h-7"][class*="w-7"] {
    width: 1.25rem;
    height: 1.25rem;
  }

  /* ========================================
     TEXT OVERFLOW HANDLING
     ======================================== */
  .page-shell h1, .page-shell h2, .page-shell h3, .page-shell h4 {
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .page-shell p, .page-shell span, .page-shell label {
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  /* Truncate long text with ellipsis when needed */
  .page-shell .truncate-mobile {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
}

/* ========================================
   SMALL MOBILE BREAKPOINT (max-width: 480px)
   Extra compact styling for very small screens
   ======================================== */
@media (max-width: 480px) {
  :root {
    --mobile-card-padding: 0.75rem;
    --mobile-gap-md: 0.75rem;
  }

  .page-shell button,
  .page-shell [role="button"] {
    padding: 0.375rem 0.5rem;
    font-size: 0.8125rem;
  }

  /* Force icon-only buttons on very small screens */
  .page-shell .compact-btn span:not([class*="icon"]):not([class*="sr-only"]) {
    display: none;
  }

  .page-shell [class*="text-2xl"],
  .page-shell [class*="text-3xl"] {
    font-size: 1.125rem !important;
  }
}

/* ========================================
   UTILITY CLASSES FOR COMPONENTS
   ======================================== */
/* Mobile-only display */
@media (max-width: 768px) {
  .desktop-only { display: none !important; }
  .mobile-only { display: flex !important; }
}

@media (min-width: 769px) {
  .mobile-only { display: none !important; }
  .desktop-only { display: flex !important; }
}

/* Touch-friendly spacing */
.touch-target {
  min-height: 44px;
  min-width: 44px;
}
`
      }}
    />
  );
}
