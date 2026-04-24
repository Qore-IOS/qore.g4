'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export type ConfirmAnimationVariant = 'success' | 'info';

export interface OrderConfirmAnimationProps {
  open: boolean;
  label?: string;
  variant?: ConfirmAnimationVariant;
  onClose: () => void;
  autoCloseMs?: number;
}

/**
 * Full-screen Face-ID style confirmation overlay.
 * Backdrop blur -> SVG circle stroke -> checkmark draw -> ripple rings -> label slide-up.
 * Auto-closes after autoCloseMs (default 2200ms).
 */
export default function OrderConfirmAnimation({
  open,
  label = 'Sipariş Kaydedildi',
  variant = 'success',
  onClose,
  autoCloseMs = 2200,
}: OrderConfirmAnimationProps) {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(t);
  }, [open, autoCloseMs, onClose]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cn('lt-confirm-overlay', `lt-confirm-overlay--${variant}`)}
      role="status"
      aria-live="polite"
      onClick={onClose}
    >
      <div className="lt-confirm-stage">
        <span className="lt-confirm-ring lt-confirm-ring--1" aria-hidden="true" />
        <span className="lt-confirm-ring lt-confirm-ring--2" aria-hidden="true" />

        <svg
          className="lt-confirm-svg"
          viewBox="0 0 120 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle
            className="lt-confirm-circle"
            cx="60"
            cy="60"
            r="52"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            className="lt-confirm-check"
            d="M38 62 L54 78 L84 46"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="lt-confirm-label">{label}</div>
    </div>,
    document.body
  );
}
