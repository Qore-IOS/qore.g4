// Mac-vari "genie" küçültme/geri getirme — clip-path warp keyframe'leri (WAAPI).
// Demo genie.jsx ile birebir aynı keyframe yapısı: { clipPath, transform,
// opacity }. (Keyframe'e webkitClipPath eklemek bazı motorlarda clip-path
// interpolasyonunu bozup yalnızca translateY'in oynamasına — yani warp yerine
// düz kaymaya — yol açıyor.)

interface GenieFrame {
  clipPath: string;
  transform: string;
  opacity: number;
}

function buildGenieFrames(
  rect: DOMRect,
  targetX: number,
  targetY: number,
  slotW: number,
): GenieFrame[] {
  const W = rect.width || 1;
  const cx = ((targetX - rect.left) / W) * 100; // huni merkezi, genişliğin %'si
  const half = (slotW / 2 / W) * 100; // yuva yarı genişliği, %
  const dy = targetY - rect.top; // üst kenarı dock'a indirecek px
  const M = 12; // dikey örnek sayısı
  const STEPS = 16;
  const frames: GenieFrame[] = [];
  for (let s = 0; s <= STEPS; s++) {
    const p = s / STEPS;
    const tp = p * p * (3 - 2 * p); // smoothstep iniş
    const ty = tp * dy;
    const right: string[] = [];
    const left: string[] = [];
    for (let j = 0; j <= M; j++) {
      const y = j / M; // 0 üst .. 1 alt
      let f = p * 1.85 - (1 - y) * 1.0; // alt satırlar önce "emilir"
      f = Math.max(0, Math.min(1, f));
      f = f * f * (3 - 2 * f); // boyun kenarlarını yumuşat
      const lx = 0 * (1 - f) + (cx - half) * f;
      const rx = 100 * (1 - f) + (cx + half) * f;
      right.push(`${rx.toFixed(2)}% ${(y * 100).toFixed(2)}%`);
      left.push(`${lx.toFixed(2)}% ${(y * 100).toFixed(2)}%`);
    }
    const poly = right.concat(left.reverse()).join(', ');
    frames.push({
      clipPath: `polygon(${poly})`,
      transform: `translateY(${ty.toFixed(1)}px)`,
      opacity: p > 0.92 ? 1 - (p - 0.92) / 0.08 : 1,
    });
  }
  return frames;
}

function writeFrame(el: HTMLElement, f: GenieFrame) {
  el.style.clipPath = f.clipPath;
  (el.style as unknown as { webkitClipPath: string }).webkitClipPath = f.clipPath;
  el.style.transform = f.transform;
  el.style.opacity = String(f.opacity);
}

/** Elemanı tamamen büzülmüş (dock'a inmiş) son kareye sabitler — restore
 *  öncesi flash'ı önlemek için. */
export function applyGenieCollapsed(
  el: HTMLElement,
  targetX: number,
  targetY: number,
  slotW = 56,
) {
  const frames = buildGenieFrames(el.getBoundingClientRect(), targetX, targetY, slotW);
  writeFrame(el, frames[frames.length - 1]);
}

/** Genie tarafından bırakılan inline stilleri temizler. */
export function clearGenie(el: HTMLElement) {
  el.style.clipPath = '';
  (el.style as unknown as { webkitClipPath: string }).webkitClipPath = '';
  el.style.transform = '';
  el.style.opacity = '';
  el.style.willChange = '';
}

interface GenieOpts {
  reverse?: boolean;
  onDone?: () => void;
  slotW?: number;
  duration?: number;
  rect?: DOMRect;
}

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

  el.style.willChange = 'transform, clip-path, opacity';
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
    easing: 'cubic-bezier(.42,0,.58,1)',
    fill: 'forwards',
  });
  anim.onfinish = () => {
    if (reverse) clearGenie(el);
    onDone?.();
  };
  return anim;
}
