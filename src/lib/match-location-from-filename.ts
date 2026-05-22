/**
 * Dosya adından (örn. "Acibadem_Maslak_İrsaliye_2026.pdf") sistemde tanımlı bir
 * hastane/laboratuvar veya depo eşleştirir. Diakritik temizliği ile token
 * tabanlı karşılaştırma yapar; ayrıca varsa konum kodunu (Hospital.kod) tek
 * geçişle yakalar.
 */
export interface LocationCandidate {
  id: string;
  name: string;
  /** Hospital.kod gibi kısa kod (varsa, dosya adında doğrudan geçebilir). */
  kod?: string;
}

export interface LocationMatch {
  id: string;
  name: string;
  /** 0-1 arası eşleşme puanı. Kod eşleşmesi 0.95+ üretir. */
  confidence: number;
  /** Neden eşleştiğini açıklayan kısa not (UI'da görmek için). */
  reason: 'kod' | 'name';
}

const TR_DIACRITIC_MAP: Record<string, string> = {
  ç: 'c', Ç: 'c',
  ğ: 'g', Ğ: 'g',
  ı: 'i', İ: 'i', I: 'i',
  ö: 'o', Ö: 'o',
  ş: 's', Ş: 's',
  ü: 'u', Ü: 'u',
};

function normalize(value: string): string {
  if (!value) return '';
  let out = '';
  for (const ch of value) out += TR_DIACRITIC_MAP[ch] ?? ch;
  return out
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP_TOKENS = new Set([
  'irsaliye', 'irs', 'sevk', 'fatura', 'pdf', 'evrak', 'belge', 'kopya',
  'final', 'son', 'yeni', 'temiz', 'taranmis', 'taranan', 'tarandi',
  'hastane', 'hastanesi', 'lab', 'labi', 'laboratuvar', 'laboratuvari',
  'depo', 'deposu', 'ana', 'merkez', 'merkezi',
]);

/**
 * Dosya adından konum tahmini.
 *
 * Strateji:
 *  1. Konum kodu dosya adı içinde tek başına bir token olarak geçiyorsa anında %95 confidence.
 *  2. Aksi halde konum adındaki anlamlı token'ların (en az 3 harf, stopword değil)
 *     dosya adında geçme oranı hesaplanır. En yüksek skoru tutarız.
 *  3. confidence >= 0.6 ve en yakın rakibinden en az 0.15 fark varsa kabul edilir,
 *     yoksa belirsiz sayılır (null döner).
 */
export function matchLocationFromFileName(
  fileName: string,
  candidates: LocationCandidate[]
): LocationMatch | null {
  if (!fileName || candidates.length === 0) return null;
  const haystack = normalize(fileName);
  if (!haystack) return null;
  const haystackTokens = new Set(haystack.split(' ').filter(t => t.length >= 2));

  let best: { c: LocationCandidate; score: number; reason: LocationMatch['reason'] } | null = null;
  let secondScore = 0;

  for (const c of candidates) {
    if (!c.id || !c.name) continue;

    // 1. Konum kodu (örn. "BAK01") dosya adında varsa öncelikli eşleşme.
    if (c.kod) {
      const kodNorm = normalize(c.kod);
      if (kodNorm && kodNorm.length >= 2 && haystackTokens.has(kodNorm)) {
        const score = 0.95;
        if (!best || score > best.score) {
          secondScore = best?.score ?? 0;
          best = { c, score, reason: 'kod' };
        } else if (score > secondScore) {
          secondScore = score;
        }
        continue;
      }
    }

    // 2. İsim token'larının dosya adında geçme oranı.
    const nameTokens = normalize(c.name)
      .split(' ')
      .filter(t => t.length >= 3 && !STOP_TOKENS.has(t));
    if (nameTokens.length === 0) continue;

    let hits = 0;
    for (const t of nameTokens) if (haystack.includes(t)) hits += 1;
    const ratio = hits / nameTokens.length;
    // İstem-dışı kısa adlar için minimum 2 anlamlı kelime ya da %100 eşleşme.
    if (nameTokens.length === 1 && ratio < 1) continue;

    if (!best || ratio > best.score) {
      secondScore = best?.score ?? 0;
      best = { c, score: ratio, reason: 'name' };
    } else if (ratio > secondScore) {
      secondScore = ratio;
    }
  }

  if (!best) return null;
  // Kod eşleşmesi her zaman güvenli.
  if (best.reason === 'kod') {
    return { id: best.c.id, name: best.c.name, confidence: best.score, reason: 'kod' };
  }
  if (best.score < 0.6) return null;
  // En yakın rakipten yeterince ayrışmadıysa belirsiz say.
  if (best.score - secondScore < 0.15 && best.score < 0.9) return null;
  return { id: best.c.id, name: best.c.name, confidence: best.score, reason: 'name' };
}
