/**
 * Dosya adından (örn. "Acibadem_Maslak_İrsaliye_2026.pdf") sistemde tanımlı bir
 * hastane/laboratuvar veya depo eşleştirir. Birebir eşleşme yerine en yakın
 * eşleşmeyi seçer — kısaltma, akronim, ilk-kelime ve prefix eşleşmelerini
 * tanır.
 *
 * Örnek kabuller:
 *  - "goztepe.pdf"     → "Göztepe Eğitim ve Araştırma Hastanesi" (ilk token)
 *  - "siyami.pdf"      → "Siyami Ersek EAH" (ilk token)
 *  - "zk.pdf"          → "Zeynep Kamil Çocuk Hastanesi" (akronim "zk" veya "zkc")
 *  - "AcbdmMaslak.pdf" → "Acıbadem Maslak" (prefix + tam token karması)
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
  reason: 'kod' | 'akronim' | 'ilk_kelime' | 'prefix' | 'name';
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

/** Konum/dosya adında anlamsal değer taşımayan token'lar — eşleşmeye sayılmaz. */
const STOP_TOKENS = new Set([
  // Dosya tipi / iş türü
  'irsaliye', 'irs', 'sevk', 'fatura', 'evrak', 'belge', 'kopya',
  'final', 'son', 'yeni', 'temiz', 'taranmis', 'taranan', 'tarandi', 'orijinal',
  // Format / etiketleme
  'pdf', 'xlsx', 'xls', 'doc', 'docx',
  // Konum türü genel kelimeler
  'hastane', 'hastanesi', 'lab', 'labi', 'laboratuvar', 'laboratuvari',
  'depo', 'deposu', 'ana', 'merkez', 'merkezi',
  'eah', 'sbu', 'sb', // Eğitim ve Araştırma Hastanesi, SBÜ vs (kısaltma stopword)
  // Türkçe bağlaçlar (NFD sonrası 2-3 harflik connective'ler)
  've', 'ile', 'ya', 'veya', 'icin',
  // Ortak sağlık/kurum stop kelimeleri (yanlış eşleşmeleri/akronimleri engellemek için)
  'devlet', 'tip', 'merkezi', 'dernegi', 'vakfi', 'ozel', 'prof', 'dr', 'acil', 'durum',
  'saglik', 'ocagi', 'hizmetleri', 'baskanligi', 'mudurlugu', 'universitesi',
  'ortakligi', 'limited', 'sirketi', 'ltd', 'sti', 'as',
]);

interface NormalizedCandidate {
  c: LocationCandidate;
  /** Konum adındaki tüm anlamlı token'lar (stopword temizliği sonrası). */
  meaningful: string[];
  /** İlk anlamlı token (genelde konumu en iyi temsil eden ad). */
  firstMeaningful: string;
  /** Anlamlı token'ların baş harflerinden üretilen akronim varyantları. */
  acronyms: Set<string>;
  /** Normalize edilmiş konum kodu (varsa). */
  kod: string;
}

function buildCandidate(c: LocationCandidate): NormalizedCandidate | null {
  const allTokens = normalize(c.name).split(' ').filter(Boolean);
  // Min 2 harfli tokenları al (Türkçe'de "iç" gibi kısalar olabilir ama 2 yeterli).
  const meaningful = allTokens.filter(t => t.length >= 2 && !STOP_TOKENS.has(t));
  if (meaningful.length === 0) return null;

  // Akronim varyantları: ilk N tokenın baş harfleri (n = 2..4).
  // "Zeynep Kamil Çocuk Hastanesi" → meaningful: [zeynep, kamil, cocuk] → {zk, zkc}
  // "Siyami Ersek" → meaningful: [siyami, ersek] → {se}
  const acronyms = new Set<string>();
  if (meaningful.length >= 2) {
    const allInits = meaningful.map(t => t[0]).join('');
    if (allInits.length >= 2 && allInits.length <= 6 && !STOP_TOKENS.has(allInits)) {
      acronyms.add(allInits);
    }
    for (let n = 2; n <= Math.min(meaningful.length, 4); n++) {
      const prefix = meaningful.slice(0, n).map(t => t[0]).join('');
      if (prefix.length >= 2 && !STOP_TOKENS.has(prefix)) {
        acronyms.add(prefix);
      }
    }
  }

  return {
    c,
    meaningful,
    firstMeaningful: meaningful[0],
    acronyms,
    kod: c.kod ? normalize(c.kod) : '',
  };
}

interface ScoredCandidate {
  cand: NormalizedCandidate;
  score: number;
  reason: LocationMatch['reason'];
}

function scoreCandidate(
  cand: NormalizedCandidate,
  haystack: string,
  haystackTokens: Set<string>,
  meaningfulHaystackTokens: Set<string>
): ScoredCandidate | null {
  // 1. Konum kodu varsa tam token eşleşmesi → en güçlü sinyal (0.95).
  if (cand.kod && cand.kod.length >= 2 && haystackTokens.has(cand.kod)) {
    return { cand, score: 0.95, reason: 'kod' };
  }

  // 2. Akronim / kısaltma eşleşmesi (zk, zkc, se, vb.). Dosya adında tek başına veya
  //    kısmi akronim olarak (örn. "zkm" -> "zk") geçiyorsa güçlü işaret.
  for (const acr of cand.acronyms) {
    // 2a. Tam akronim eşleşmesi
    if (haystackTokens.has(acr)) {
      return { cand, score: 0.95, reason: 'akronim' };
    }
    // 2b. Kısmi akronim/kısaltma eşleşmesi (örn. dosyadaki "zkm" tokenı aday "zk" akronimini içeriyor/başlıyor)
    for (const token of meaningfulHaystackTokens) {
      if (token.length >= 2 && acr.length >= 2) {
        if (token.startsWith(acr) || acr.startsWith(token)) {
          return { cand, score: 0.90, reason: 'akronim' };
        }
      }
    }
  }

  // 3. Token bazlı eşleşmeler (tam + prefix).
  let exactHits = 0;
  let firstTokenMatched = false;
  for (let i = 0; i < cand.meaningful.length; i++) {
    if (haystackTokens.has(cand.meaningful[i])) {
      exactHits += 1;
      if (i === 0) firstTokenMatched = true;
    }
  }

  // Prefix eşleşmesi: dosya adındaki anlamlı bir token (≥3 harf), konum
  // tokeniyle ortak ≥4 karakterlik bir öneki paylaşıyorsa say.
  let prefixHits = 0;
  let firstTokenPrefix = false;
  const seenNameTokenIdx = new Set<number>();
  for (const ft of meaningfulHaystackTokens) {
    if (ft.length < 3) continue;
    for (let i = 0; i < cand.meaningful.length; i++) {
      if (seenNameTokenIdx.has(i)) continue;
      const nt = cand.meaningful[i];
      if (nt === ft) continue; // tam eşleşmeyi yukarıda saydık
      if (nt.length < 4) continue;
      const shorter = Math.min(nt.length, ft.length);
      if (shorter < 4) continue;
      if (nt.startsWith(ft) || ft.startsWith(nt)) {
        prefixHits += 1;
        seenNameTokenIdx.add(i);
        if (i === 0) firstTokenPrefix = true;
        break;
      }
    }
  }

  if (exactHits === 0 && prefixHits === 0) return null;

  const tokenCount = cand.meaningful.length;
  const ratio = (exactHits + 0.7 * prefixHits) / tokenCount;

  // İlk anlamlı token tam eşleştiyse en az 0.85 (kullanıcı çoğu kısaltmada
  // ilk kelimeyi yazıyor: "siyami" → "Siyami Ersek EAH").
  if (firstTokenMatched && tokenCount >= 2) {
    return { cand, score: Math.max(ratio, 0.85), reason: 'ilk_kelime' };
  }
  // İlk token prefix benzerliğiyle yakalandıysa 0.75 floor.
  if (firstTokenPrefix && tokenCount >= 2) {
    return { cand, score: Math.max(ratio, 0.75), reason: 'prefix' };
  }
  // Sadece tek tokenlık konum adı varsa, tam eşleşme şart (1.0 ratio).
  if (tokenCount === 1) {
    if (exactHits === 1) return { cand, score: 0.9, reason: 'name' };
    if (prefixHits === 1) return { cand, score: 0.75, reason: 'prefix' };
    return null;
  }

  return { cand, score: Math.min(ratio, 0.99), reason: 'name' };
}

/**
 * Dosya adından konum tahmini. En yüksek skor + rakipten ayrışma kuralıyla
 * karar verir; belirsizliklerde null döner (kullanıcı manuel atar).
 */
export function matchLocationFromFileName(
  fileName: string,
  candidates: LocationCandidate[]
): LocationMatch | null {
  if (!fileName || candidates.length === 0) return null;
  const haystack = normalize(fileName);
  if (!haystack) return null;

  const allHaystackTokens = haystack.split(' ').filter(t => t.length >= 2);
  const haystackTokens = new Set(allHaystackTokens);
  const meaningfulHaystackTokens = new Set(
    allHaystackTokens.filter(t => !STOP_TOKENS.has(t))
  );

  const builtCands = candidates
    .map(c => (c.id && c.name ? buildCandidate(c) : null))
    .filter((c): c is NormalizedCandidate => !!c);

  let best: ScoredCandidate | null = null;
  let second: ScoredCandidate | null = null;

  for (const cand of builtCands) {
    const scored = scoreCandidate(cand, haystack, haystackTokens, meaningfulHaystackTokens);
    if (!scored) continue;
    if (!best || scored.score > best.score) {
      second = best;
      best = scored;
    } else if (!second || scored.score > second.score) {
      second = scored;
    }
  }

  if (!best) return null;

  // Kod ve akronim eşleşmeleri çok güvenli; başka rakipler 0.85+ skor almadıkça
  // doğrudan kabul ederiz.
  if (best.reason === 'kod' || best.reason === 'akronim') {
    if (!second || second.score < 0.85 || (best.score - second.score) >= 0.1) {
      return {
        id: best.cand.c.id,
        name: best.cand.c.name,
        confidence: best.score,
        reason: best.reason,
      };
    }
  }

  if (best.score < 0.6) return null;

  // Birden fazla aday yüksek skor aldıysa ve aralarında belirgin fark yoksa,
  // belirsiz sayıp manuel atama bekleriz (yanlış konuma atamaktan iyi).
  const gap = second ? best.score - second.score : 1;
  if (gap < 0.1 && best.score < 0.9) return null;

  return {
    id: best.cand.c.id,
    name: best.cand.c.name,
    confidence: best.score,
    reason: best.reason,
  };
}
