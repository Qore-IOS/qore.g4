'use client';
import React from 'react';

export default function MobileResponsiveFix() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
:root { --page-h-padding: 0rem; }

@media (max-width: 768px) {
  html, body { overflow-x: hidden; }
  .page-shell { padding-left: var(--page-h-padding); padding-right: var(--page-h-padding); }

  /* Cards & headings */
  .page-shell .card, .page-shell .shadcn-card { overflow: hidden; }
  .page-shell .card h1, .page-shell .card h2, .page-shell .card h3 { word-break: break-word; overflow-wrap: anywhere; }
  .page-shell .btn-group, .page-shell [role="tablist"] { flex-wrap: wrap; row-gap: .5rem; max-width: 100%; overflow-x: auto; }

  /* Dialogs */
  .page-shell .dialog-content { width: 92vw !important; max-width: 92vw !important; max-height: 90vh; overflow-y: auto; border-radius: .75rem; }

  /* Generic stack helper */
  .stack-on-mobile { display: grid; grid-template-columns: 1fr; gap: .75rem; }
  .stack-on-mobile > * { min-width: 0; }

  /* ===== TABLES: forced stacked mode (no horizontal scroll) ===== */
  .q-table { width: 100%; }
  .q-table thead { display: none; }
  .q-table tbody tr {
    display: block;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--background) / 0.6);
    border-radius: 0.75rem;
    padding: .25rem;
    margin-bottom: .75rem;
  }
  .q-table tbody td {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: .5rem;
    padding: .5rem .75rem;
    word-break: break-word;
    overflow-wrap: anywhere;
    white-space: normal;
  }
  .q-table tbody td::before {
    content: attr(data-label);
    font-weight: 600;
    color: hsl(var(--foreground));
    opacity: .8;
    text-align: left;
  }
  .q-table tbody td[data-primary="true"] { font-size: .95rem; }
  .q-table tbody td * { min-width: 0; } /* buttons/badges wrap */
  .q-table tbody td img { max-width: 100%; height: auto; display: inline-block; }
}
`
      }}
    />
  );
}
