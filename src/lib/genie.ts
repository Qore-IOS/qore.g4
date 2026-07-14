// Mac-vari "genie" küçültme/geri getirme — clip-path warp keyframe'leri (WAAPI).
// Demo genie.jsx ile birebir aynı keyframe yapısı: { clipPath, transform,
// opacity }. (Keyframe'e webkitClipPath eklemek bazı motorlarda clip-path
// interpolasyonunu bozup yalnızca translateY'in oynamasına — yani warp yerine
// düz kaymaya — yol açıyor.)

interface GenieFrame {
  clipPath: string;
  transform: string;
  opacity: number;
  filter: string;
}

/* ================================================================
   Math helpers
   ================================================================ */

/** Hermite smooth-step (C¹ sürekli) */
function smoothstep(t: number): number {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

/** Perlin's smoother-step (C² sürekli — daha yumuşak geçiş) */
function smootherstep(t: number): number {
  t = Math.max(0, Math.min(1, t));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Logistic sigmoid — merkez 0, sigmoid(0)=0.5 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Cubic ease-out: hızlı başla, yavaş bitir */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/* ================================================================
   Configuration
   ================================================================ */

const VERTS = 48; // her kenar için vertex sayısı — pürüzsüz polygon
const STEPS = 30; // animasyon keyframe sayısı

/* ================================================================
   Frame builder — Bézier warp
   ================================================================ */

/**
 * `rect` → kaynak elemanın BoundingClientRect'i.
 * `targetX` → dock yuvasının yatay merkezi (px, viewport).
 * `targetY` → dock yuvasının üst kenarı (px, viewport).
 * `slotW`  → dock yuvasının genişliği (px).
 *
 * Üretilen frame dizisi minimize yönünde (büyük → küçük) sıralanır.
 * Restore için `.reverse()` uygulanır.
 */
function buildGenieFrames(
  rect: DOMRect,
  targetX: number,
  targetY: number,
  slotW: number,
): GenieFrame[] {
  const W = rect.width || 1;
  const H = rect.height || 1;

  // ── Hedef merkezinin eleman-lokal koordinatları (%, 0-100) ──
  const cx = ((targetX - rect.left) / W) * 100;
  const halfSlot = ((slotW / 2) / W) * 100;

  // ── Dikey mesafe: elemanın ALT kenarından dock yuvasının merkezine ──
  // Böylece huninin ucu (polygon %100 y) dock yuvasının tam ortasına gelir.
  const slotCenterY = targetY + slotW * 0.45; // ikon merkezine biraz daha yakın
  const dy = slotCenterY - rect.bottom;

  const frames: GenieFrame[] = [];

  for (let s = 0; s <= STEPS; s++) {
    const t = s / STEPS; // ham ilerleme 0→1

    /* ──────────────────────────────────────────────────────
       Traveling neck parametreleri
       ──────────────────────────────────────────────────────
       "Boyun" (neck), huninin tam genişlikten yuva genişliğine geçtiği
       dikey konumdur.  Animasyon ilerledikçe boyun alttan yukarıya doğru
       hareket eder.
    */
    // neckY: 0=üst, 1=alt.  Animasyon başında ~1.1 (elemanın altında),
    // sonunda ~-0.5 (elemanın üstünde) — böylece son karede her şey emilmiş olur.
    const neckY = 1.1 - t * 1.65;

    // Sigmoid keskinliği: animasyon ilerledikçe artar → boyun sıkışır.
    const sharpness = 2.8 + t * 16.0;

    // Üst kenarlar da zamanla hafifçe daralır ("squeeze before suck" hissi).
    const topSqueeze = smoothstep(t) * 0.10;

    /* ──────────────────────────────────────────────────────
       Polygon noktaları
       ────────────────────────────────────────────────────── */
    const rightPts: string[] = [];
    const leftPts: string[] = [];

    for (let i = 0; i <= VERTS; i++) {
      const y = i / VERTS; // 0=üst, 1=alt

      // ── Sigmoid emme faktörü ──
      // Boyunun altındaki satırlar (y > neckY) → suck≈1 (tam emilmiş)
      // Boyunun üstündeki satırlar (y < neckY) → suck≈0 (tam genişlik)
      let suck = sigmoid((y - neckY) * sharpness);
      // Ekstra yumuşatma — organik his
      suck = smootherstep(suck);
      // İlerleme kapısı: t=0'da suck=0 (TAM dikdörtgen) garanti — böylece son
      // kare (restore'da tutulan) yırtık bırakmaz, animasyon tam-ekrandan başlar.
      suck *= smoothstep(Math.min(1, t * 1.3));

      // ── Yatay konumlar ──
      // Üst (tam genişlik tarafı): hafif squeeze ile
      const squeezeFactor = topSqueeze * (1 - y * 0.5); // üstte daha çok, altta daha az
      const rFull = 100 - squeezeFactor * 100;
      const lFull = squeezeFactor * 100;

      // Alt (hedef yuva tarafı):
      const rTarget = cx + halfSlot;
      const lTarget = cx - halfSlot;

      // Lerp
      let rx = rFull + (rTarget - rFull) * suck;
      let lx = lFull + (lTarget - lFull) * suck;

      // ── Bézier boyun bulge'ı ──
      // Geçiş bölgesinde kenarları hafifçe dışa iter → genie lambası boynu şekli.
      // Boyun merkezinde Gaussian çan eğrisi.
      const nd = (y - neckY) * Math.sqrt(sharpness); // normalleştirilmiş mesafe
      const bulge = Math.exp(-nd * nd * 0.45);
      // Bulge miktarı: animasyon ilerledikçe azalır (son karede sıfır)
      const bulgeAmt = bulge * Math.max(0, 1 - t * 0.8) * 6.0;

      rx = Math.min(100, rx + bulgeAmt);
      lx = Math.max(0, lx - bulgeAmt);

      rightPts.push(`${rx.toFixed(2)}% ${(y * 100).toFixed(2)}%`);
      leftPts.push(`${lx.toFixed(2)}% ${(y * 100).toFixed(2)}%`);
    }
    const poly = rightPts.concat(leftPts.reverse()).join(', ');
    // Dikey iniş: eleman, t ile birlikte dock yuvasına doğru kayar. WAAPI
    // zaman çizelgesi easing'i (ease-out) tüm hareketi yumuşatır.
    const ty = t * dy;
    frames.push({
      clipPath: `polygon(${poly})`,
      transform: `translateY(${ty.toFixed(1)}px)`,
      opacity: t > 0.92 ? 1 - (t - 0.92) / 0.08 : 1,
      filter: '',
    });
  }

  return frames;
}

/* ================================================================
   DOM helpers
   ================================================================ */

function writeFrame(el: HTMLElement, f: GenieFrame) {
  el.style.clipPath = f.clipPath;
  (el.style as unknown as { webkitClipPath: string }).webkitClipPath = f.clipPath;
  el.style.transform = f.transform;
  el.style.opacity = String(f.opacity);
  el.style.filter = f.filter;
}

/**
 * Elemanı tamamen büzülmüş (dock'a inmiş) son kareye sabitler.
 * Restore öncesi flash'ı önlemek için çağrılır.
 */
export function applyGenieCollapsed(
  el: HTMLElement,
  targetX: number,
  targetY: number,
  slotW = 56,
) {
  const frames = buildGenieFrames(
    el.getBoundingClientRect(),
    targetX,
    targetY,
    slotW,
  );
  writeFrame(el, frames[frames.length - 1]);
}

/** Genie tarafından bırakılan inline stilleri temizler. */
export function clearGenie(el: HTMLElement) {
  el.style.clipPath = '';
  (el.style as unknown as { webkitClipPath: string }).webkitClipPath = '';
  el.style.transform = '';
  el.style.opacity = '';
  el.style.filter = '';
  el.style.willChange = '';
  // Minimize sırasında ayarlanan visibility/pointerEvents'i de temizle
  // (React'ın inline style prop'unun tekrar kontrolü almasını sağlar).
  el.style.visibility = '';
  el.style.pointerEvents = '';
}

/* ================================================================
   Public API
   ================================================================ */

interface GenieOpts {
  reverse?: boolean;
  onDone?: () => void;
  slotW?: number;
  duration?: number;
  rect?: DOMRect;
}

/**
 * Genie animasyonunu başlatır.
 *
 * @param el        Anime edilecek DOM elemanı (pencere içerik sarmalayıcı).
 * @param targetX   Dock yuvasının yatay merkezi (px, viewport).
 * @param targetY   Dock yuvasının üst kenarı (px, viewport).
 * @param opts      Opsiyonel yapılandırma.
 * @returns         WAAPI Animation nesnesi (veya WAAPI yoksa null).
 */
export function runGenie(
  el: HTMLElement,
  targetX: number,
  targetY: number,
  opts: GenieOpts = {},
): Animation | null {
  const { reverse = false, onDone, slotW = 56, duration = 600, rect: rectOverride } = opts;
  const rect = rectOverride || el.getBoundingClientRect();
  let frames = buildGenieFrames(rect, targetX, targetY, slotW);
  if (reverse) frames = frames.slice().reverse();

  // Önceki genie animasyonunun "fill:forwards" ile takılı kalmış efektini temizle
  // (yoksa yeni animasyon üst üste biner / eski kare ezilemez).
  try {
    if (typeof el.getAnimations === 'function') {
      el.getAnimations().forEach((a) => a.cancel());
    }
  } catch {
    /* yoksay */
  }

  el.style.willChange = 'transform, clip-path, opacity, filter';
  // İlk kareyi senkron uygula (1 karelik flash'ı önlemek için).
  writeFrame(el, frames[0]);

  if (typeof el.animate !== 'function') {
    // WAAPI yoksa anında bitir.
    writeFrame(el, frames[frames.length - 1]);
    if (reverse) clearGenie(el);
    onDone?.();
    return null;
  }

  // Keyframe'ler yalnızca clipPath / transform / opacity içerir (demo ile aynı).
  const anim = el.animate(frames as unknown as Keyframe[], {
    duration,
    easing: 'cubic-bezier(.22,.61,.36,1)', // ease-out-cubic benzeri
    fill: 'forwards',
  });

  anim.onfinish = () => {
    // Önce WAAPI animasyonunu iptal et — fill:'forwards' ile tutulan son kareyi
    // DOM'dan kaldır. Yoksa clearGenie() inline stilleri temizlese bile WAAPI'nin
    // fill efekti bunları ezer ve clip-path/transform takılı kalır.
    try {
      anim.cancel();
    } catch {
      /* yoksay */
    }
    // Şimdi tüm inline genie stillerini güvenle temizle.
    if (reverse) {
      clearGenie(el);
    }
    onDone?.();
  };

  return anim;
}
