'use client';

/* Sarf Dağıtım — claymorphic SVG ikon seti (demo sarf-icons.jsx karşılığı).
   Kabarık (clay) tile ikonlar gradient + iç gölge ile çizilir. */

import React from 'react';

let gradSeq = 0;
const useGradId = (prefix: string) => {
  const idRef = React.useRef<string>();
  if (!idRef.current) idRef.current = `${prefix}-${++gradSeq}`;
  return idRef.current;
};

/** Turuncu/amber kabarık paket ikonu (uygulama logosu görevi görür). */
export const IconPackage = ({ s }: { s?: number }) => {
  const id = useGradId('sarfPkg');
  return (
    <svg width={s || '100%'} height={s || '100%'} viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id={`${id}-tile`} x1="10" y1="6" x2="54" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F2CD9C" />
          <stop offset="1" stopColor="#D89B66" />
        </linearGradient>
        <linearGradient id={`${id}-lid`} x1="20" y1="20" x2="44" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#F4E3CC" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="18" fill={`url(#${id}-tile)`} />
      <rect x="4" y="4" width="56" height="56" rx="18" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.4" />
      <path d="M32 16 17 24v16l15 8 15-8V24L32 16Z" fill={`url(#${id}-lid)`} opacity="0.96" />
      <path d="M17 24l15 8 15-8M32 32v16" stroke="#C68A5E" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" fill="none" />
      <path d="M24.5 20l15 8v6l-4.5 2.4v-6.2l-15-8L24.5 20Z" fill="#E8B984" opacity="0.85" />
    </svg>
  );
};

/** Krem/beyaz kabarık bina (poliklinik) ikonu. */
export const IconBuilding = ({ s }: { s?: number; tint?: { hi: string; lo: string } }) => {
  const id = useGradId('sarfBld');
  return (
    <svg width={s || '100%'} height={s || '100%'} viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id={`${id}-tile`} x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#EDE3D0" />
        </linearGradient>
        <linearGradient id={`${id}-body`} x1="24" y1="16" x2="42" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FBF8F1" />
          <stop offset="1" stopColor="#E4D9C4" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="18" fill={`url(#${id}-tile)`} />
      <rect x="4" y="4" width="56" height="56" rx="18" fill="none" stroke="rgba(176,158,128,0.30)" strokeWidth="1.2" />
      <rect x="23" y="15" width="18" height="34" rx="3" fill={`url(#${id}-body)`} stroke="#8FA67E" strokeWidth="1.8" />
      {[21, 28, 35].map((y) => (
        <React.Fragment key={y}>
          <rect x="27" y={y} width="4" height="4" rx="1" fill="#8FA67E" opacity="0.75" />
          <rect x="33" y={y} width="4" height="4" rx="1" fill="#8FA67E" opacity="0.75" />
        </React.Fragment>
      ))}
      <rect x="29.5" y="42" width="5" height="7" rx="1.4" fill="#8FA67E" />
      <path d="M19 49h26" stroke="#8FA67E" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
};

/** Renkli kapaklı tüp sporu (rack) ikonu — cap: kapak rengi. */
export const TubeRack = ({ cap, s }: { cap?: string; s?: number }) => {
  const id = useGradId('sarfTube');
  const c = cap || '#DBB36C';
  return (
    <svg width={s || '100%'} height={s || '100%'} viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id={`${id}-tile`} x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#F0E8D8" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="16" fill={`url(#${id}-tile)`} />
      <rect x="4" y="4" width="56" height="56" rx="16" fill="none" stroke="rgba(176,158,128,0.30)" strokeWidth="1.2" />
      {[17, 25, 33, 41].map((x) => (
        <React.Fragment key={x}>
          <rect x={x} y="18" width="6" height="5" rx="1.6" fill={c} />
          <rect x={x + 0.8} y="23" width="4.4" height="20" rx="2.2" fill="#FFFFFF" stroke="rgba(140,132,116,0.55)" strokeWidth="1.1" />
          <rect x={x + 0.8} y="33" width="4.4" height="10" rx="2.2" fill={c} opacity="0.30" />
        </React.Fragment>
      ))}
      <rect x="12" y="42" width="40" height="6" rx="3" fill="#E4D9C4" />
    </svg>
  );
};

export const IconQr = ({ s }: { s?: number }) => (
  <svg width={s || 14} height={s || 14} viewBox="0 0 24 24" fill="none">
    <rect x="3" y="3" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2" />
    <rect x="14" y="3" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2" />
    <rect x="3" y="14" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2" />
    <path d="M14 14h3v3h-3zM18 18h3v3h-3z" fill="currentColor" />
  </svg>
);

export const IconSearch = ({ s }: { s?: number }) => (
  <svg width={s || 17} height={s || 17} viewBox="0 0 24 24" fill="none">
    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2" />
    <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export const IconBack = ({ s }: { s?: number }) => (
  <svg width={s || 16} height={s || 16} viewBox="0 0 24 24" fill="none">
    <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconChevron = ({ s }: { s?: number }) => (
  <svg width={s || 16} height={s || 16} viewBox="0 0 24 24" fill="none">
    <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconClipboard = ({ s }: { s?: number }) => (
  <svg width={s || 17} height={s || 17} viewBox="0 0 24 24" fill="none">
    <rect x="5" y="4" width="14" height="17" rx="2.4" stroke="currentColor" strokeWidth="2" />
    <rect x="9" y="2.4" width="6" height="3.6" rx="1.4" fill="currentColor" />
    <path d="M9 11h6M9 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const IconCheck = ({ s, w }: { s?: number; w?: number }) => (
  <svg width={s || 15} height={s || 15} viewBox="0 0 24 24" fill="none">
    <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth={w || 3} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconX = ({ s }: { s?: number }) => (
  <svg width={s || 14} height={s || 14} viewBox="0 0 24 24" fill="none">
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

export const IconPrinter = ({ s }: { s?: number }) => (
  <svg width={s || 15} height={s || 15} viewBox="0 0 24 24" fill="none">
    <path d="M7 8V4h10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="4" y="8" width="16" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
    <rect x="7" y="14" width="10" height="6" rx="1.4" fill="currentColor" opacity="0.25" />
    <rect x="7" y="14" width="10" height="6" rx="1.4" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const IconLogout = ({ s }: { s?: number }) => (
  <svg width={s || 16} height={s || 16} viewBox="0 0 24 24" fill="none">
    <path d="M14 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M17 8l4 4-4 4M21 12H10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
