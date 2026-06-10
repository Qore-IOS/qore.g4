"use client";

import React, { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Apple "Liquid Glass" yüzeyi.
 *
 * Chromium'da `backdrop-filter: url(#filter)` ile SVG displacement map
 * kullanarak arkadaki sahneyi GERÇEKTEN kırar: kenarlarda lens bükülmesi,
 * RGB kanallarının ayrı ayrı yer değiştirmesiyle kromatik renk saçılımı.
 * Backdrop her karede compositor tarafından örneklendiği için kırılma,
 * o anki ekran içeriğine göre canlı davranır (scroll, video, animasyon).
 *
 * Safari/Firefox SVG filtrelerini backdrop-filter içinde desteklemediğinden
 * blur + saturate + parlama katmanlarıyla zarif bir fallback uygulanır.
 */

let cachedSupport: boolean | null = null;
function supportsSvgBackdropFilter(): boolean {
  if (cachedSupport !== null) return cachedSupport;
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  // SVG url() backdrop-filter bugün yalnızca Chromium motorlarında çalışıyor.
  const isChromium = /chrom(e|ium)|edg\//i.test(ua) && !/firefox|fxios/i.test(ua);
  const hasBackdrop =
    typeof CSS !== 'undefined' &&
    (CSS.supports('backdrop-filter', 'blur(1px)') ||
      CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));
  cachedSupport = isChromium && hasBackdrop;
  return cachedSupport;
}

/**
 * Yuvarlatılmış dikdörtgenin signed-distance alanından kenar-bükme
 * (displacement) haritası üretir. R kanalı x, G kanalı y yönündeki
 * yer değiştirme vektörünü kodlar (128 = nötr). Kenara yaklaştıkça
 * vektör dışarıyı gösterir → feDisplacementMap kenar pikselleri dış
 * sahneden örnekler ve gerçek bir mercek kenarı görünümü oluşur.
 */
function makeDisplacementMap(
  w: number,
  h: number,
  radius: number,
  bezel: number,
): string | null {
  if (typeof document === 'undefined') return null;
  const W = Math.max(2, Math.round(w));
  const H = Math.max(2, Math.round(h));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const r = Math.min(radius, W / 2, H / 2);
  const cx = W / 2;
  const cy = H / 2;
  const hw = W / 2;
  const hh = H / 2;

  const sdf = (px: number, py: number) => {
    const qx = Math.abs(px - cx) - (hw - r);
    const qy = Math.abs(py - cy) - (hh - r);
    const ax = Math.max(qx, 0);
    const ay = Math.max(qy, 0);
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - r;
  };

  const img = ctx.createImageData(W, H);
  const data = img.data;
  const band = Math.min(bezel, Math.min(W, H) / 2);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const depth = -sdf(px, py); // kenardan içeri doğru mesafe
      let m = 0;
      if (depth <= 0) {
        m = 1;
      } else if (depth < band) {
        const t = depth / band;
        m = Math.pow(1 - t, 1.7); // kenarda güçlü, içeride sıfırlanan bükülme
      }
      let dx = 0;
      let dy = 0;
      if (m > 0.004) {
        const gx = sdf(px + 1, py) - sdf(px - 1, py);
        const gy = sdf(px, py + 1) - sdf(px, py - 1);
        const len = Math.hypot(gx, gy) || 1;
        dx = (gx / len) * m;
        dy = (gy / len) * m;
      }
      const i = (y * W + x) * 4;
      data[i] = Math.round(128 + dx * 127);
      data[i + 1] = Math.round(128 + dy * 127);
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

export interface LiquidGlassSurfaceProps {
  /** Köşe yarıçapı (px) — kapsayıcının border-radius'u ile aynı olmalı. */
  radius: number;
  className?: string;
  /** Kırılma şiddeti (px cinsinden maksimum yer değiştirme). */
  strength?: number;
  /** Kromatik saçılım oranı (0–1): RGB kanallarının kırılma farkı. */
  dispersion?: number;
  /** Kırılma modunda uygulanan ek blur (px). */
  blur?: number;
  /** Fallback modunda uygulanan blur (px). */
  fallbackBlur?: number;
  /** Kenar bükülme bandının genişliği (px). */
  bezel?: number;
  /** İmleci takip eden spekülar parlama. */
  shine?: boolean;
}

export function LiquidGlassSurface({
  radius,
  className,
  strength = 24,
  dispersion = 0.3,
  blur = 2.5,
  fallbackBlur = 22,
  bezel = 16,
  shine = true,
}: LiquidGlassSurfaceProps) {
  const rawId = useId();
  const filterId = `lqg-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(supportsSvgBackdropFilter());
  }, []);

  // Boyutu izle; değişimde displacement haritasını (debounce ile) yeniden üret.
  useEffect(() => {
    if (!supported) return;
    const el = rootRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const regen = (w: number, h: number) => {
      setSize({ w, h });
      setMapUrl(makeDisplacementMap(w, h, radius, bezel));
    };
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 2 || rect.height < 2) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => regen(w, h), 90);
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width >= 2 && rect.height >= 2) {
      regen(Math.round(rect.width), Math.round(rect.height));
    }
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [supported, radius, bezel]);

  // İmleç konumuna göre spekülar parlama + rim ışığının açısını güncelle.
  useEffect(() => {
    if (!shine) return;
    const el = rootRef.current;
    if (!el) return;
    let raf = 0;
    let lastX = 0;
    let lastY = 0;
    const apply = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      const mx = (lastX - rect.left) / rect.width;
      const my = (lastY - rect.top) / rect.height;
      const cxv = lastX - (rect.left + rect.width / 2);
      const cyv = lastY - (rect.top + rect.height / 2);
      // CSS gradient açısı: 0deg yukarı; imlecin yönünü gösterecek şekilde.
      const ang = Math.atan2(cxv, -cyv) * (180 / Math.PI);
      el.style.setProperty('--lqg-mx', String(Math.max(-0.3, Math.min(1.3, mx))));
      el.style.setProperty('--lqg-my', String(Math.max(-0.3, Math.min(1.3, my))));
      el.style.setProperty('--lqg-ang', `${ang.toFixed(1)}deg`);
    };
    const onMove = (e: PointerEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [shine]);

  const useRefraction = supported && mapUrl && size.w > 1 && size.h > 1;
  const backdrop = useRefraction
    ? `url(#${filterId}) blur(${blur}px) saturate(1.75) brightness(1.05)`
    : `blur(${fallbackBlur}px) saturate(1.8) brightness(1.04)`;

  return (
    <div
      ref={rootRef}
      aria-hidden
      className={cn('lqg-surface', className)}
      style={{ '--lqg-r': `${radius}px` } as React.CSSProperties}
    >
      {useRefraction && (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
          <defs>
            <filter
              id={filterId}
              x="0"
              y="0"
              width={size.w}
              height={size.h}
              filterUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
            >
              <feImage
                href={mapUrl!}
                x="0"
                y="0"
                width={size.w}
                height={size.h}
                preserveAspectRatio="none"
                result="map"
              />
              {/* RGB kanalları farklı şiddetle kırılır → kromatik saçılım */}
              <feDisplacementMap
                in="SourceGraphic"
                in2="map"
                scale={strength * (1 + dispersion)}
                xChannelSelector="R"
                yChannelSelector="G"
                result="dispR"
              />
              <feColorMatrix
                in="dispR"
                type="matrix"
                values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                result="chR"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="map"
                scale={strength}
                xChannelSelector="R"
                yChannelSelector="G"
                result="dispG"
              />
              <feColorMatrix
                in="dispG"
                type="matrix"
                values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                result="chG"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="map"
                scale={strength * (1 - dispersion)}
                xChannelSelector="R"
                yChannelSelector="G"
                result="dispB"
              />
              <feColorMatrix
                in="dispB"
                type="matrix"
                values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                result="chB"
              />
              <feBlend in="chR" in2="chG" mode="screen" result="chRG" />
              <feBlend in="chRG" in2="chB" mode="screen" />
            </filter>
          </defs>
        </svg>
      )}

      {/* Kırılma katmanı: arkadaki sahneyi canlı büker */}
      <div
        className="lqg-layer lqg-refract"
        style={{ backdropFilter: backdrop, WebkitBackdropFilter: backdrop }}
      />
      {/* Cam gövde tonu */}
      <div className="lqg-layer lqg-tint" />
      {/* İç hacim/derinlik ışığı */}
      <div className="lqg-layer lqg-bevel" />
      {/* İmleci takip eden spekülar parlama */}
      {shine && <div className="lqg-layer lqg-sheen" />}
      {/* Işığa göre dönen 1px cam kenar çizgisi */}
      <div className="lqg-layer lqg-rim" />
    </div>
  );
}
